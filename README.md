# GitHub Action: Trigger JIRA Automation Webhook

This GitHub Action triggers the JIRA automation webhook URL with details about the pull request, including its status, title, and labels.  
The provided data can be used with `webhookData.pullRequest.FIELD` in JIRA automation.

## Inputs

### `GITHUB_TOKEN`

**Required** The GitHub token.

### `ignore-title`

**Optional** Ignore the pull request title to find issue IDs.  
**Default**: `false`

### `ignore-commits`

**Optional** Ignore commit messages to find issue IDs.  
**Default**: `false`

### `find-regex-commits`

**Optional** Regex to find issue IDs in commit messages.  
**Default**: `/([A-Za-z]{2,4}-\d+)/g`

### `find-regex-title`

**Optional** Regex to find issue IDs in the pull request title.  
**Default**: `/([A-Za-z]{2,4}-\d+)/g`

### `approval-threshold`

**Optional** Approvals required (in percent (50%) or as a number (2)) before a pull request's state is "approved".  
**Default**: `1`

### `force-changes-requested`

**Optional** If true, the pull request status is `changes_requested` regardless of whether the `approval_threshold` is reached.  
**Default**: `true`

### `webhook-urls`

**Required** The JIRA webhook URLs to be called. The URL is split by the project task alias with a colon. Use a newline for multiple project aliases, and `*` for every project alias.

#### Examples:

```text
FOO:https://webhook-for-foo.com
BAR:https://webhook-for-bar.com
*:https://webhook-for-all.com
```

### `additional-reposotires`

**Optional** List of additional repositories to check for the latest pull request titles containing JIRA IDs. Separate multiple repository names with commas (owner/repository-name).  
**Default**: `''`

### `additional-repositories-pull-request-limit`

**Optional** Number of pull requests to check in the additional repositories (1-100).  
**Default**: `100`

## Example Usage

```yaml
name: Trigger JIRA Automation Webhook

on: [pull_request]

jobs:
  jira-automation-webhook:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger JIRA Automation Webhook
        uses: derpierre65/jira-automation-action@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          webhook-urls: ${{ secrets.JIRA_WEBHOOK_URLS }}
          ignore-title: 'false'
          ignore-commits: 'false'
          find-regex-commits: '/([A-Za-z]{2,4}-\d+)/g'
          find-regex-title: '/([A-Za-z]{2,4}-\d+)/g'
          approval-threshold: '1'
          force-changes-requested: 'true'
          additional-repos: 'derpierre65/jira-automation-action,derpierre65/action-test'
          additional-repositories-pull-request-limit: '50'
```