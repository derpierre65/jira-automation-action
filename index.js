import * as core from '@actions/core';
import * as github from '@actions/github';

async function getPullRequestData(octokit) {
  const {data: pullRequest} = await octokit.request(`GET ${github.context.payload.pull_request._links.self.href}`);

  return pullRequest;
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

function getIssueIds(messages) {
  const issueIds = [];
  for (const message of messages) {
    issueIds.push(...message.match(/([A-Za-z]{2,4}-\d+)/g) || []);
  }

  return [...new Set(issueIds)];
}

async function run() {
  const token = core.getInput('GITHUB_TOKEN');
  if (!token) {
    core.setFailed('GITHUB_TOKEN is required');
    return;
  }

  console.log('urls', core.getInput('urls'));
  console.log(JSON.stringify(github.context, null, 4));

  const octokit = github.getOctokit(token);
  const commitMessages = await fetchCommitMessages(octokit);
  const pullRequest = await getPullRequestData(octokit);
  const issueIds = getIssueIds(commitMessages);

  core.info(JSON.stringify(commitMessages));
  core.info(JSON.stringify(issueIds));
  core.info(JSON.stringify(pullRequest));
}

run().catch(error => core.setFailed(error.message));