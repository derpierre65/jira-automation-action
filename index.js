import * as core from '@actions/core';
import * as github from '@actions/github';
import axios from 'axios';

let findCommitRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);
let findTitleRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);

const PullRequestStatus = {
  CHANGES_REQUESTED: 'changes_requested',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  DRAFT: 'draft',
};

async function getReviews(octokit) {
  const {data} = await octokit.request(`GET ${github.context.payload.pull_request._links.self.href}/reviews`, {
    per_page: 100,
  });

  if (data.length >= 100) {
    core.warning('More than 100 reviews were found. The action can only fetch the latest 100 reviews, which may result in an incorrect pull request state.');
  }

  return data;
}

async function getRequestedReviewers(octokit) {
  const {data} = await octokit.request(`GET ${github.context.payload.pull_request._links.self.href}/requested_reviewers`);

  return data;
}

async function fetchCommitMessages(octokit) {
  const commitMessages = [];
  let hasMoreCommits = true;
  let perPage = 100;
  let page = 1;

  while (hasMoreCommits) {
    core.info(`Fetching commits page ${page}`);

    const {data: commits} = await octokit.request(`GET ${github.context.payload.pull_request.commits_url}`, {
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

  core.info(`pull request status: ${status}`);
  for (const key of Object.keys(webhookIssues)) {
    core.info(`call webhook ${key} with issue ids: ${webhookIssues[key].join(', ')}`);
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

async function run() {
  const token = core.getInput('GITHUB_TOKEN');
  if (!token) {
    core.setFailed('GITHUB_TOKEN is required');
    return;
  }

  // load settings
  const ignoreTitle = core.getBooleanInput('ignore-title');
  const ignoreCommits = core.getBooleanInput('ignore-commits');
  const approvalThreshold = core.getInput('approval-threshold');
  const forceChangesRequested = core.getBooleanInput('force-changes-requested');

  findCommitRegex = loadRegexFromString(core.getInput('find-regex-commits'));
  findTitleRegex = loadRegexFromString(core.getInput('find-regex-title'));

  const octokit = github.getOctokit(token);
  const commitMessages = ignoreCommits ? [] : await fetchCommitMessages(octokit);
  const pullRequestTitle = ignoreTitle ? '' : github.context.payload.pull_request.title;

  // get all issue ids in commit message and pull request title
  const issueIds = getIssueIds(commitMessages, pullRequestTitle);
  if (!issueIds.length) {
    // do nothing, no issue ids found.
    return;
  }

  if (github.context.payload.pull_request.draft) {
    return callWebhook(issueIds, PullRequestStatus.DRAFT);
  }

  const reviewers = {};

  core.info(JSON.stringify(await getRequestedReviewers(octokit), null, 4));

  // fetch all reviews
  const reviews = await getReviews(octokit);
  for (const review of reviews) {
    if (review.user.type === 'Bot') {
      continue;
    }

    core.info(JSON.stringify(review, null, 4));

    reviewers[review.user.id] = review.state;
  }

  const requestedReviewers = (await getRequestedReviewers(octokit)).users.filter((user) => user.type === 'User');
  for (const reviewer of requestedReviewers) {
    reviewers[reviewer.id] = 'PENDING';
  }

  const reviewersStates = Object.values(reviewers);
  const approvals = reviewersStates.filter((state) => state === 'APPROVED').length;
  const changesRequested = reviewersStates.filter((state) => state === 'CHANGES_REQUESTED').length;

  // use changes_requested as state if forceChangesRequested is true, otherwise check the approval threshold
  if (forceChangesRequested && changesRequested) {
    return callWebhook(issueIds, PullRequestStatus.CHANGES_REQUESTED);
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
    return callWebhook(issueIds, PullRequestStatus.APPROVED);
  }

  return callWebhook(
    issueIds,
    changesRequested ? PullRequestStatus.CHANGES_REQUESTED : PullRequestStatus.IN_REVIEW,
  );
}

run().catch(error => core.setFailed(error.message));