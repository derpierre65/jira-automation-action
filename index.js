import * as core from '@actions/core';
import * as github from '@actions/github';

let findCommitRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);
let findTitleRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);

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
  const matches = [...string.matchAll(regExp)].map((match) => match[0]);
  console.log(regExp, string, matches);
  return matches;
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
  const issuePrefixUrls = {};
  for (const url of webhookUrls) {
    const issuePrefix = url.slice(0, url.indexOf(':'));
    const webhookUrl = url.slice(url.indexOf(':') + 1);

    issuePrefixUrls[issuePrefix] = webhookUrl;
  }

  const webhooks = {};
  const prefixes = Object.keys(webhookUrls);
  for (const issueId of issueIds) {
    const matchPrefixes = prefixes.filter((prefix) => prefix === '*' || issueId.indexOf(prefix) === 0);
    for (const prefix of matchPrefixes) {
      webhooks[prefix] ??= [];
      webhooks[prefix].push(issueId);
    }
  }

  console.log(`pull request status: ${status}`);
  console.log(issueIds);
  console.log(issuePrefixUrls);
  console.log(webhooks);
  console.log(JSON.stringify(github.context, null, 4));
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
    return callWebhook(issueIds, 'in_review');
  }

  let reviewers = 0;
  let approvals = 0;

  const reviews = await getReviews(octokit);
  for (const review of reviews) {
    if (review.user.type === 'Bot') {
      continue;
    }

    reviewers++;
    if (review.state === 'APPROVED') {
      approvals++;
    }
  }

  const requiredApprovals = parseInt(approvedThreshold);

  if (!approvedThreshold.includes('%')) {
    if (approvals >= requiredApprovals) {
      return callWebhook(issueIds, 'approved');
    }

    return callWebhook(issueIds, 'in_review');
  }

  const requestedReviewers = await getRequestedReviewers(octokit);
  reviewers += requestedReviewers.users.filter((user) => user.type === 'User').length;

  const approvalPercent = approvals / reviewers * 100;
  if (approvalPercent >= approvedThreshold) {
    return callWebhook(issueIds, 'approved');
  }

  return callWebhook(issueIds, 'in_review');
}

run().catch(error => core.setFailed(error.message));