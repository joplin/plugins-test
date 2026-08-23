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
| [🏠](https://github.com/akshajrawat/joplin-test-plugin-) | [⬇️](https://github.com/joplin/plugins/raw/master/plugins/com.akshajrawat.final-submission-test/plugin.jpl) | Final Submission Test | 1.0.0 | A simple plugin for demonstrating the complete Joplin plugin submission flow. | Akshaj Rawat |
| -     | [⬇️](https://github.com/joplin/plugins/raw/master/plugins/com.test4.registeredNameLookup/plugin.jpl) | joplin-plugin-ownership-name-lookup-test | 1.0.0 | Registry-only fixture for testing ownership lookup by plugin name. | tester |
| -     | [⬇️](https://github.com/joplin/plugins/raw/master/plugins/com.test4.legacyNpmMigration/plugin.jpl) | Legacy NPM Migration Registry Fixture | 1.0.0 | Registry-only fixture for testing migration from legacy NPM publishing. | tester |
| [🏠](https://github.com/akshajrawat/joplin-test-plugin-) | [⬇️](https://github.com/joplin/plugins/raw/master/plugins/com.test1.normal-plugin-flow/plugin.jpl) | Normal Plugin test flow  | 1.0.1 | This is the test for the happy path for the plugin publish | tester |
| -     | [⬇️](https://github.com/joplin/plugins/raw/master/plugins/com.test4.ownershipById/plugin.jpl) | Ownership By ID Registry Fixture | 1.0.0 | Registry-only fixture for rejecting an existing plugin ID submitted from a different repository. | tester |
| [🏠](https://github.com/akshajrawat/joplin-test-plugin-) | [⬇️](https://github.com/joplin/plugins/raw/master/plugins/com.test4.submittedNameLookup/plugin.jpl) | Ownership By Name Submission Test | 1.0.0 | Submission fixture whose package name matches an existing registry entry from another repository. | tester |
| [🏠](https://github.com/akshajrawat/joplin-test-plugin-) | [⬇️](https://github.com/joplin/plugins/raw/master/plugins/com.akshajrawat.submit-flow-test/plugin.jpl) | Submit Flow Test | 1.0.6 | A simple plugin for testing the complete Joplin plugin submission flow. | Akshaj Rawat |
<!-- PLUGIN_LIST -->
