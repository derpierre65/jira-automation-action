import * as core from '@actions/core';
import * as github from '@actions/github';

let findCommitRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);
let findTitleRegex = new RegExp(/([A-Za-z]{2,4}-\d+)/g);

async function getPullRequestData(octokit) {
  const {data: pullRequest} = await octokit.request(`GET ${github.context.payload.pull_request._links.self.href}`);

  return pullRequest;
}

async function getReviewData(octokit) {
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
    issueIds.push(getRegExpMatches(findCommitRegex, message));
  }

  if (prTitle) {
    issueIds.push(getRegExpMatches(findTitleRegex, prTitle));
  }

  return [...new Set(issueIds)];
}

async function run() {
  const token = core.getInput('GITHUB_TOKEN');
  if (!token) {
    core.setFailed('GITHUB_TOKEN is required');
    return;
  }

  // load settings
  const ignoreTitle = core.getBooleanInput('ignore_title');
  const ignoreCommits = core.getBooleanInput('ignore_commits');

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

  const pullRequestState = pullRequest.state;

  console.log('urls', core.getInput('urls'));
  console.log(JSON.stringify(github.context, null, 4));

  const reviewData = await getReviewData(octokit);
  console.log(JSON.stringify(reviewData, null, 4));

  const reviewers = await getRequestedReviewers(octokit);
  console.log(JSON.stringify(reviewers, null, 4));
}

run().catch(error => core.setFailed(error.message));