## Releasing a new version

1. Add release notes to `CHANGELOG.md`.
1. Run `yarn release` in the repository root folder. This will create a new tag
   like `v1.0.0`.
1. Wait until the `release` GitHub workflow has finished.
1. Once the release ready to go, you can go to
   https://github.com/expo/eas-cli/releases and mark it as not draft.
1. Run `yarn lerna publish from-git` in the repository root folder. This will publish the packages to npm.
