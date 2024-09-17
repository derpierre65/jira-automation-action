import * as core from '@actions/core';

try {
  // /([A-Za-z]{2,4}-\d+)/g

  console.log('urls', core.getInput('urls'));
}
catch (error) {
  core.setFailed(error.message);
}