## Releasing a new version

1. Run `yarn release` in the repository root folder.
2. Wait, the `release` workflow on GitHub Actions is going to take care of the rest (including publishing packages to npm and updating the changelog).
3. Check the changelog. If any of the entries have been tagged with `[EAS BUILD API]`
   - Open `package.json` and note the version of `@expo/eas-build-job` used in the eas-cli.
   - Find the `Publish` commit in [expo/eas-build](https://github.com/expo/eas-build/commits) for that version. In most cases, it will be the latest `Publish` commit.
   - Find the `eas-cli-local-build-plugin` version published in that commit.
     ![example publish commit](./.gh-assets/eas-build-publish-commit.png)
   - Run `npm dist-tags add eas-cli-local-build-plugin@VERSION latest` with the version from the previous step.
