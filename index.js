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
    const data = await octokit.request(`GET ${context.payload.pull_request.commits_url}`);

    console.log(data);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run();