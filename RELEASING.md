# Releasing EAS CLI

1. Invoke the GitHub workflow ["Manually trigger a release"](https://github.com/expo/eas-cli/actions/workflows/trigger-release.yml). The next version is chosen automatically based on the changelog entries. If you want to use different version, pass the version string as an input to the workflow, in semver format, e.g. "1.2.3"
2. That's it! GitHub Actions is going to take care of the rest. Watch the #eas-cli Slack channel for a successful release notification.

The release also sets the `STAGING` version in `cli-versions.json`. It does not change the `PRODUCTION` version. See [EAS Build CLI versions](#eas-build-cli-versions).

## EAS Build CLI versions

`cli-versions.json` at the repository root sets which `eas-cli` version EAS Build installs. It has two fields:

- `STAGING`: the version used on the staging build servers.
- `PRODUCTION`: the version used on the production build servers.

This file replaces the old `latest-eas-build` and `latest-eas-build-staging` npm dist-tags. The build servers read the file from the `main` branch.

A release updates `STAGING` to the new version automatically. To promote a version to production, invoke the GitHub workflow ["Promote eas-cli to production"](https://github.com/expo/eas-cli/actions/workflows/promote-eas-cli-production.yml). Pass the version to promote as an input. If you leave the input empty, the workflow uses the current `STAGING` version. The workflow checks that the version is published on npm before it updates `PRODUCTION`.

## Choosing the next version

As stated above, the next EAS CLI version is chosen automatically based on the existing changelog entries under the unreleased section in **CHANGELOG.md**.

The algorithm works as follows:

- If there are any entries in the "🛠 Breaking changes" section, bump the MAJOR version.
- Otherwise, if there are any entries in the "🎉 New features", bump the MINOR version.
- Otherwise, bump the PATCH version.
