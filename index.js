import * as core from '@actions/core';

try {
  // /([A-Za-z]{2,4}-\d+)/g

  console.log('test', [
    core.getInput('status'),
    core.getInput('urls'),
  ]);
}
catch (error) {
  core.setFailed(error.message);
}