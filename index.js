import * as core from '@actions/core';
import * as github from '@actions/github';
import axios from 'axios';

let findCommitRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);
let findTitleRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);
let octokit = null;
let ignoreTitle = false;
let ignoreCommits = false;
let approvalThreshold = 1;
let forceChangesRequested = false;

const PullRequestStatus = {
  CHANGES_REQUESTED: 'changes_requested',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  DRAFT: 'draft',
  MERGED: 'merged',
};
const pullRequestStatusPriority = {
  [PullRequestStatus.DRAFT]: 1,
  [PullRequestStatus.CHANGES_REQUESTED]: 2,
  [PullRequestStatus.IN_REVIEW]: 3,
  [PullRequestStatus.APPROVED]: 4,
  [PullRequestStatus.MERGED]: 5,
};

async function getReviews(owner, repository, id) {
  const url = `GET https://api.github.com/repos/${owner}/${repository}/pulls/${id}/reviews`;
  core.info(url);
  const {data} = await octokit.request(url, {
    per_page: 100,
  });

  if (data.length >= 100) {
    core.warning('More than 100 reviews were found. The action can only fetch the latest 100 reviews, which may result in an incorrect pull request state.');
  }

  return data;
}

async function getRequestedReviewers(owner, repository) {
  let url = `GET https://api.github.com/repos/${owner}/${repository}/requested_reviewers`;
  core.info(url);
  const {data} = await octokit.request(url);

  return data;
}

async function getPullRequests(owner, repository, perPage = 100) {
  const url = `GET https://api.github.com/repos/${owner}/${repository}/pulls`;
  core.info(url);
  const {data} = await octokit.request(url, {
    per_page: Math.min(perPage, 100),
  });

  return data;
}

async function fetchCommitMessages(owner, repository, id) {
  const commitMessages = [];
  let hasMoreCommits = true;
  let perPage = 100;
  let page = 1;

  while (hasMoreCommits) {
    const url = `GET https://api.github.com/repos/${owner}/${repository}/pulls/${id}/commits`;
    core.info(url);
    const {data: commits} = await octokit.request(url, {
      page,
      per_page: perPage,
    });

    commits.forEach(commit => commitMessages.push(commit.commit.message));

    hasMoreCommits = commits.length === perPage;
    page++;
  }

  return commitMessages;
}

function loadRegexFromString(regexString) {
  // Extract the pattern and the flag
  const pattern = regexString.slice(1, regexString.lastIndexOf('/'));
  const flags = regexString.slice(regexString.lastIndexOf('/') + 1);

  // Create the RegExp object
  return new RegExp(pattern, flags);
}

function getRegExpMatches(regExp, string) {
  return [...string.matchAll(regExp)].map((match) => match[0]);
}

function getIssueIds(messages, prTitle) {
  const issueIds = [];
  for (const message of messages) {
    issueIds.push(...getRegExpMatches(findCommitRegex, message));
  }

  if (prTitle) {
    issueIds.push(...getRegExpMatches(findTitleRegex, prTitle));
  }

  return [...new Set(issueIds)];
}

function callWebhook(issueIds, status) {
  const webhookUrls = core.getInput('webhook-urls').split('\n');
  const webhookUrlsByPrefix = {};
  for (const url of webhookUrls) {
    const colonPosition = url.indexOf(':');
    webhookUrlsByPrefix[url.slice(0, colonPosition)] = url.slice(colonPosition + 1);
  }

  const webhookIssues = {};
  const prefixes = Object.keys(webhookUrlsByPrefix);
  for (const issueId of issueIds) {
    const matchPrefixes = prefixes.filter((prefix) => prefix === '*' || issueId.indexOf(prefix) === 0);

    for (const prefix of matchPrefixes) {
      webhookIssues[prefix] ??= [];
      webhookIssues[prefix].push(issueId);
    }
  }

  core.info(`Pull request status: ${status}`);
  for (const key of Object.keys(webhookIssues)) {
    core.info(`Call webhook ${key} with issue ids: ${webhookIssues[key].join(', ')}`);
    axios.post(webhookUrlsByPrefix[key], {
      issues: webhookIssues[key],
      pullRequest: {
        status,
        title: github.context.payload.pull_request.title,
        labels: github.context.payload.pull_request.labels.map((label) => {
          return label.name;
        }),
      }
    });
  }
}

async function fetchPullRequestStatus(owner, repository, pullRequest) {
  const commitMessages = ignoreCommits ? [] : await fetchCommitMessages(owner, repository, pullRequest.number);
  const pullRequestTitle = ignoreTitle ? '' : pullRequest.title;

  // get all issue ids in commit message and pull request title
  const issueIds = getIssueIds(commitMessages, pullRequestTitle);
  if (!issueIds.length) {
    // do nothing, no issue ids found.
    return;
  }

  if (pullRequest.merged) {
    return callWebhook(issueIds, PullRequestStatus.MERGED);
  }

  if (pullRequest.draft) {
    return callWebhook(issueIds, PullRequestStatus.DRAFT);
  }

  const reviewers = {};

  // fetch all reviews
  const reviews = await getReviews(owner, repository, pullRequest.number);
  for (const review of reviews) {
    if (review.user.type === 'Bot') {
      continue;
    }

    reviewers[review.user.id] = review.state;
  }

  const requestedReviewers = (await getRequestedReviewers(owner, repository)).users.filter((user) => user.type === 'User');
  for (const reviewer of requestedReviewers) {
    reviewers[reviewer.id] = 'PENDING';
  }

  const reviewersStates = Object.values(reviewers);
  const approvals = reviewersStates.filter((state) => state === 'APPROVED').length;
  const changesRequested = reviewersStates.filter((state) => state === 'CHANGES_REQUESTED').length;

  // use changes_requested as state if forceChangesRequested is true, otherwise check the approval threshold
  if (forceChangesRequested && changesRequested) {
    return {
      issueIds,
      status: PullRequestStatus.CHANGES_REQUESTED,
    };
  }

  let isApproved;

  // check for number values (e.g. only 1 approval is required)
  if (!approvalThreshold.includes('%')) {
    isApproved = approvals >= parseInt(approvalThreshold);
  }
  // check for a percent values (e.g. 50% of the reviewers need to approve the request)
  else {
    isApproved = approvals / reviewersStates.length * 100 >= approvalThreshold;
  }

  if (isApproved) {
    return {
      issueIds,
      status: PullRequestStatus.APPROVED,
    };
  }

  return {
    issueIds,
    status: changesRequested ? PullRequestStatus.CHANGES_REQUESTED : PullRequestStatus.IN_REVIEW,
  };
}

const issueStatus = {};

async function run() {
  const token = core.getInput('GITHUB_TOKEN');
  if (!token) {
    core.setFailed('GITHUB_TOKEN is required');
    return;
  }

  // load settings
  ignoreTitle = core.getBooleanInput('ignore-title');
  ignoreCommits = core.getBooleanInput('ignore-commits');
  approvalThreshold = core.getInput('approval-threshold');
  forceChangesRequested = core.getBooleanInput('force-changes-requested');
  findCommitRegex = loadRegexFromString(core.getInput('find-regex-commits'));
  findTitleRegex = loadRegexFromString(core.getInput('find-regex-title'));
  octokit = github.getOctokit(token);

  const ownerName = github.context.payload.pull_request.base.repo.owner.login;
  const repository = github.context.payload.pull_request.base.repo.name;
  const result = await fetchPullRequestStatus(ownerName, repository, github.context.payload.pull_request);

  const additionalRepositories = core.getInput('additional-repositories').split(',').map((repo) => repo.trim());
  if (!additionalRepositories.length) {
    return callWebhook(result.issueIds, result.status)
  }
  console.log('additionalRepositories', additionalRepositories);

  const prLimit = parseInt(core.getInput('additional-repositories-pull-request-limit'));

  for (const issueId of result.issueIds) {
    if (issueStatus[issueId]) {
      issueStatus[issueId] = Math.min(issueStatus[issueId], pullRequestStatusPriority[result.status]);
    } else {
      issueStatus[issueId] = pullRequestStatusPriority[result.status];
    }
  }

  for (const additionalRepository of additionalRepositories) {
    const [owner, repository] = additionalRepository.split('/');
    const pullRequests = await getPullRequests(owner, repository, prLimit);

    for (const pullRequest of pullRequests) {
      console.log(pullRequest.title);
      const issueIds = getIssueIds([], pullRequest.title);
      console.log(issueIds);
    }

    // for (const pr of limitedPullRequests) {
    //   const prResult = await fetchPullRequestStatus(owner, repository, pr);
    //   for (const issueId of prResult.issueIds) {
    //     if (issueStatus[issueId]) {
    //       issueStatus[issueId] = Math.min(issueStatus[issueId], pullRequestStatusPriority[prResult.status]);
    //     } else {
    //       issueStatus[issueId] = pullRequestStatusPriority[prResult.status];
    //     }
    //   }
    // }
  }

  callWebhook(result.issueIds, result.status);
}

run().catch(error => core.setFailed(error.message));