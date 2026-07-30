# Releasing EAS CLI

1. Invoke the GitHub workflow ["Manually trigger a release"](https://github.com/expo/eas-cli/actions/workflows/trigger-release.yml). The next version is chosen automatically based on the changelog entries. If you want to use different version, pass the version string as an input to the workflow, in semver format, e.g. "1.2.3"
2. That's it! GitHub Actions is going to take care of the rest. Watch the #eas-cli Slack channel for a successful release notification.

## Choosing the next version

As stated above, the next EAS CLI version is chosen automatically based on the existing changelog entries under the unreleased section in **CHANGELOG.md**.

The algorithm works as follows:

- If there are any entries in the "🛠 Breaking changes" section, bump the MAJOR version.
- Otherwise, if there are any entries in the "🎉 New features", bump the MINOR version.
- Otherwise, bump the PATCH version.

## Prereleases

A prerelease publishes a real version to npm that nobody gets by accident: it goes out
under the `next` dist-tag, so `latest` keeps pointing at the current stable release and
`npx eas-cli` is unaffected. Use one to get a risky change in front of users (or to dogfood
it in a real project) before committing to a stable release.

**Cutting one:** invoke the same ["Manually trigger a release"](https://github.com/expo/eas-cli/actions/workflows/trigger-release.yml)
workflow, but pass an explicit prerelease version — e.g. `21.3.0-beta.0`. Any version with a
SemVer prerelease identifier (the part after the hyphen) is treated as a prerelease; the
identifier itself is free-form, so `-beta.0`, `-rc.1` and `-canary.0` all work. You must pass
the version explicitly: the changelog-based algorithm above only ever produces stable versions.

**Installing one:**

```sh
npm i -g eas-cli@next          # whatever the current prerelease is
npm i -g eas-cli@21.3.0-beta.0 # a specific one
```

**What a prerelease does differently.** Everything is driven off the pushed tag by
`.github/workflows/release.yml`, which detects the prerelease identifier and then:

|                                      | Stable            | Prerelease                       |
| ------------------------------------ | ----------------- | -------------------------------- |
| npm dist-tag                         | `latest`          | `next`                           |
| `latest-eas-build` / `-staging` tags | moved             | **left alone**                   |
| CHANGELOG.md                         | cut and committed | **left alone**                   |
| GitHub release                       | draft → published | published, flagged as prerelease |
| Slack announcement in #eas-cli       | yes               | no                               |

The EAS Build tags are deliberately untouched: they select the CLI version used by EAS
Build, so moving them to a prerelease would put untested code into production builds.
Move them on purpose with the ["Move NPM tags used by EAS builds and workflows"](https://github.com/expo/eas-cli/actions/workflows/move-eas-build-tag.yml)
workflow if that is what you actually want.

CHANGELOG.md is also untouched, so a prerelease's entries stay under "unreleased" and are
announced with the stable release that follows.

### Prereleases in this monorepo

Prereleases version and publish packages exactly like stable releases do — lerna runs in
fixed mode, so it applies the single version from `lerna.json` to the packages that changed
since the last release and leaves the rest alone (which is why the packages sit at different
versions). `lerna publish from-package` then publishes whichever of those aren't on the
registry yet, and the `next` dist-tag applies to every package published in that run.
`latest` is untouched for all of them, so nothing that depends on `@expo/eas-json`,
`@expo/steps`, `@expo/eas-build-job` or friends picks up a prerelease implicitly.

Two consequences worth knowing:

- **The version line is shared.** After `21.3.0-beta.0`, the next stable release from main
  is `21.3.0` — the prerelease consumes that version number for the whole repo. Cutting a
  `21.2.1` patch afterwards means passing that version explicitly.
- **main carries the prerelease version.** `lerna version` commits the bump, so `lerna.json`
  and the changed packages sit at `21.3.0-beta.0` until the next release. The changelog-based
  algorithm still resolves correctly from there (a MINOR or PATCH bump off `21.3.0-beta.0`
  both land on `21.3.0`).

### Testing an unmerged branch

Prereleases are cut from `main`, so they are not the tool for validating a PR before it
merges. For that, build the branch locally and run it directly:

```sh
yarn && yarn build
./packages/eas-cli/bin/run --version
```

or pack a tarball to install elsewhere:

```sh
cd packages/eas-cli && yarn pack   # then: npm i -g ./eas-cli-*.tgz
```
