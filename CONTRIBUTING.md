## Releasing a new version

1. Run `yarn release` in the repository root folder. The next version is chosen automatically based on the changelog entries. If you want to use different version, pass the version string as a positional argument to the command, e.g. `yarn release 1.2.3`.
2. That's it! GitHub Actions is going to take care of the rest. Watch the #eas-cli Slack channel for a successful release notification.
