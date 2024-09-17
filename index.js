import * as core from '@actions/core';
import * as github from '@actions/github';

async function run() {
  try {
    const token = core.getInput('GITHUB_TOKEN');
    if (!token) {
      core.setFailed('GITHUB_TOKEN is required');
      return;
    }

    const context = github.context;

    // /([A-Za-z]{2,4}-\d+)/g

    console.log('urls', core.getInput('urls'));
    console.log(JSON.stringify(github.context));

    const octokit = github.getOctokit(token);

    const commitMessages = [];
    let perPage = 5;
    let hasMoreCommits = true;
    let page = 1;
    while (hasMoreCommits) {
      core.info(`Fetching commits page ${page}`);

      const { data: commits } = await octokit.request(`GET ${context.payload.pull_request.commits_url}`, {
        page,
        per_page: perPage,
      });

      commits.forEach(commit => commitMessages.push(commit.commit.message));

      hasMoreCommits = commits.length === perPage;
      page++;
    }

    core.info(JSON.stringify(commitMessages));
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run();