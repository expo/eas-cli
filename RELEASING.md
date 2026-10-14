# Releasing EAS CLI

1. Invoke the GitHub workflow ["Manually trigger a release"](https://github.com/expo/eas-cli/actions/workflows/trigger-release.yml). Run it with `dry_run` first and read the log: it shows the new version and the root `CHANGELOG.md` section.
2. Run it again with `dry_run` unchecked. The workflow consumes the changesets in `.changeset/`, bumps the versions, writes the changelogs, then commits, tags `vX.Y.Z`, and pushes to `main`.
3. That's it! GitHub Actions is going to take care of the rest. Watch the #eas-cli Slack channel for a successful release notification.

The release also sets the `STAGING` and `PRODUCTION` versions in `cli-versions.json`. See [EAS Build CLI versions](#eas-build-cli-versions).

## EAS Build CLI versions

`cli-versions.json` at the repository root sets which `eas-cli` version EAS Build installs. It has two fields:

- `STAGING`: the version used on the staging build servers.
- `PRODUCTION`: the version used on the production build servers.

This file replaces the old `latest-eas-build` and `latest-eas-build-staging` npm dist-tags. The build servers read the file from the `main` branch.

A release updates `STAGING` and `PRODUCTION` to the new version automatically. To set a different version to production (to fix a regression, for example), invoke the GitHub workflow ["Promote eas-cli to production"](https://github.com/expo/eas-cli/actions/workflows/promote-eas-cli-production.yml). Pass the version to promote as an input. If you leave the input empty, the workflow uses the current `STAGING` version. The workflow checks that the version is published on npm before it updates `PRODUCTION`.

## Choosing the next version

The changesets in `.changeset/` choose the next version. All packages share one version (a changesets `fixed` group), and the highest bump in all changesets wins:

- If any changeset has a `major` bump, bump the MAJOR version.
- Otherwise, if any changeset has a `minor` bump, bump the MINOR version.
- Otherwise, bump the PATCH version.

A release fails if there are no changesets, or if all of them are `none` or empty. To force a bump, merge a changeset with that bump type. See [`.changeset/README.md`](./.changeset/README.md) for how to write a changeset.

## What a release writes

`yarn release` (`scripts/src/versionPackages.ts`) does these steps:

1. Reads the changesets and computes the new version.
2. Runs `changeset version`. This bumps every `package.json`, writes each package's `CHANGELOG.md`, and deletes the changesets.
3. Sets the version in `lerna.json`, updates `yarn.lock`, and regenerates `packages/eas-cli/README.md`.
4. Adds the new section to the root `CHANGELOG.md`. The GitHub release and the Slack message use this section.
5. Commits `vX.Y.Z`, tags it, and pushes. A dry run stops before this step.

The tag push starts the [release workflow](./.github/workflows/release.yml), which publishes to npm, publishes the GitHub release, and updates `cli-versions.json`.

The release looks up the PR and author of each changeset on GitHub, so a local dry run needs a `GITHUB_TOKEN`:

```sh
GITHUB_TOKEN=$(gh auth token) INPUT_DRY_RUN=true yarn release
```
