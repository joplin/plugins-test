# Joplin Plugins Test Repository

This repository contains all the code for new plugin publishing workflow and custom made codeQl rules that will help in scanning the plugin.

The plugins get scanned with inbuilt CodeQl rules + Custom made codeQl rules.
Some of the inbuilt rules are excluded due to their appearance in top 20 plugin.
CodeQl will be used to evaluate plugins against these rules : [RULES.md](.github/codeql/rules.md)

Find the detailed plan in : [PLAN.md](PLAN.md)

## Run the tests

Install [Node.js](https://nodejs.org/) and the [CodeQL CLI](https://docs.github.com/en/code-security/codeql-cli/getting-started-with-the-codeql-cli/setting-up-the-codeql-cli), then run:

```sh
cd scripts
npm install
npm run test
```

The test command runs the CodeQL regression tests in `.github/codeql/tests`.

## Test plugins

<!-- PLUGIN_LIST -->
| &nbsp; | &nbsp; | Name  | Version | Description | Author |
| ----- | ----- | ----- | ----- | ----- | ----- |
<!-- PLUGIN_LIST -->
