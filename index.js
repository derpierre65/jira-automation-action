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

async function getPullRequestData(octokit) {
  const {data: pullRequest} = await octokit.request(`GET ${github.context.payload.pull_request._links.self.href}`);

  return pullRequest;
}

async function getReviews(octokit) {
  const {data} = await octokit.request(`GET ${github.context.payload.pull_request._links.self.href}/reviews`);

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
  const approvedThreshold = core.getInput('approved-threshold');
  const forceChangesRequested = core.getBooleanInput('force-changes-requested');

  findCommitRegex = loadRegexFromString(core.getInput('find-regex-commits'));
  findTitleRegex = loadRegexFromString(core.getInput('find-regex-title'));

  const octokit = github.getOctokit(token);
  const commitMessages = ignoreCommits ? [] : await fetchCommitMessages(octokit);
  const pullRequest = await getPullRequestData(octokit);
  let pullRequestTitle = '';

  // add pull request to commit messages to fetch the issue ids from title
  if (!ignoreTitle) {
    pullRequestTitle = pullRequest.title;
  }

  // get all issue ids in commit message and pull request title
  const issueIds = getIssueIds(commitMessages, pullRequestTitle);
  if (!issueIds.length) {
    // do nothing, no issue ids found.
    return;
  }

  if (github.context.payload.pull_request.draft) {
    return callWebhook(issueIds, PullRequestStatus.DRAFT);
  }

  let reviewers = 0;
  let approvals = 0;
  let changesRequested = false;

  const reviews = await getReviews(octokit);
  for (const review of reviews) {
    if (review.user.type === 'Bot') {
      continue;
    }

    reviewers++;
    if (review.state === 'APPROVED') {
      approvals++;
    }

    if (review.state === 'CHANGES_REQUESTED') {
      changesRequested = true;
      if (forceChangesRequested) {
        return callWebhook(issueIds, PullRequestStatus.CHANGES_REQUESTED);
      }
    }
  }

  const requiredApprovals = parseInt(approvedThreshold);
  if (!approvedThreshold.includes('%')) {
    if (approvals >= requiredApprovals) {
      return callWebhook(issueIds, PullRequestStatus.APPROVED);
    }

    return callWebhook(issueIds, changesRequested ? PullRequestStatus.CHANGES_REQUESTED : PullRequestStatus.IN_REVIEW);
  }

  const requestedReviewers = await getRequestedReviewers(octokit);
  reviewers += requestedReviewers.users.filter((user) => user.type === 'User').length;

  const approvalPercent = approvals / reviewers * 100;
  if (approvalPercent >= approvedThreshold) {
    return callWebhook(issueIds, PullRequestStatus.APPROVED);
  }

  return callWebhook(issueIds, PullRequestStatus.IN_REVIEW);
}

run().catch(error => core.setFailed(error.message));