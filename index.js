import * as core from '@actions/core';
import * as github from '@actions/github';

try {
  const token = core.getInput('GITHUB_TOKEN');
  if (!token) {
    core.setFailed('GITHUB_TOKEN is required');
    return;
  }

  // /([A-Za-z]{2,4}-\d+)/g

  console.log('urls', core.getInput('urls'));
  console.log(process.env.GITHUB_TOKEN);
  console.log(JSON.stringify(github.context));

  console.log(github.getOctokit(token));
}
catch (error) {
  core.setFailed(error.message);
}