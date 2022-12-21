# Releasing EAS CLI

1. Run `yarn release` in the repository root folder. The next version is chosen automatically based on the changelog entries. If you want to use different version, pass the version string as a positional argument to the command, e.g. `yarn release 1.2.3`.
2. That's it! GitHub Actions is going to take care of the rest. Watch the #eas-cli Slack channel for a successful release notification.

## Choosing the next version

As stated above, the next EAS CLI version is chosen automatically based on the existing changelog entries under the unreleased section in **CHANGELOG.md**.

The algorithm works as follows:

- If there are any entries in the "🛠 Breaking changes" section, bump the MAJOR version.
- Otherwise, if there are any entries in the "🎉 New features", bump the MINOR version.
- Otherwise, bump the PATCH version.
