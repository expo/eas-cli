## Releasing a new version

1. Run `yarn release` in the repository root folder. This will create a new tag like `v1.0.0`.
1. **Wait until the `release` GitHub workflow has finished.**
1. Once the release is ready to go, you can go to https://github.com/expo/eas-cli/releases and mark it as not draft.
   - Remember to copy the changelog entries from `CHANGELOG.md`.
1. Run `yarn lerna publish from-git` in the repository root folder. This will publish the packages to npm.
1. Update `CHANGELOG.md`.
   - Add the new section with the release version in the title.
   - Leave the `main` section empty (without any changelog entries).
