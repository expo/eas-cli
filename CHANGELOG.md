# Changelog

This is the log of notable changes to EAS CLI and related packages.

## main

### 🛠 Breaking changes

### 🎉 New features

- Add update:revert-update-rollout command. ([#3068](https://github.com/expo/eas-cli/pull/3068) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

### 🧹 Chores

## [16.13.1](https://github.com/expo/eas-cli/releases/tag/v16.13.1) - 2025-06-25

### 🐛 Bug fixes

- Fix bug in log during update:republish. ([#3067](https://github.com/expo/eas-cli/pull/3067) by [@wschurman](https://github.com/wschurman))
Fix update group deletion. ([#3069](https://github.com/expo/eas-cli/pull/3069) by [@wschurman](https://github.com/wschurman))

## [16.13.0](https://github.com/expo/eas-cli/releases/tag/v16.13.0) - 2025-06-24

### 🎉 New features

- Add `--what-to-test` option to `build` command. ([#3065](https://github.com/expo/eas-cli/pull/3065) by [@vonovak](https://github.com/vonovak))

### 🐛 Bug fixes

- Hide `workflow:list`. ([#3060](https://github.com/expo/eas-cli/pull/3060) by [@douglowder](https://github.com/douglowder))
- Align text of messages from `build` and `workflow:run`. ([#3061](https://github.com/expo/eas-cli/pull/3061) by [@douglowder](https://github.com/douglowder))

## [16.12.0](https://github.com/expo/eas-cli/releases/tag/v16.12.0) - 2025-06-20

### 🎉 New features

- Add `--what-to-test` option to the `submit` command. ([#3023](https://github.com/expo/eas-cli/pull/3023) by [@vonovak](https://github.com/vonovak))

### 🐛 Bug fixes

- Fixed monorepo support in `workflow:run` if a project is not connected to a GitHub repository. ([#3058](https://github.com/expo/eas-cli/pull/3058) by [@sjchmiela](https://github.com/sjchmiela))

## [16.10.1](https://github.com/expo/eas-cli/releases/tag/v16.10.1) - 2025-06-13

### 🐛 Bug fixes

- Fixed `eas build:dev` command to correctly use passed build profile. ([#3053](https://github.com/expo/eas-cli/pull/3053) by [@sebryu](https://github.com/sebryu))

### 🧹 Chores

- Allow rolling out update on empty branch. ([#3050](https://github.com/expo/eas-cli/pull/3050) by [@wschurman](https://github.com/wschurman))

## [16.10.0](https://github.com/expo/eas-cli/releases/tag/v16.10.0) - 2025-06-12

### 🎉 New features

- [eas-cli] Add workflow:cancel. ([#3048](https://github.com/expo/eas-cli/pull/3048) by [@douglowder](https://github.com/douglowder))

### 🧹 Chores

- Removed repack support. ([#3044](https://github.com/expo/eas-cli/pull/3044) by [@kudo](https://github.com/kudo))

## [16.9.0](https://github.com/expo/eas-cli/releases/tag/v16.9.0) - 2025-06-06

### 🎉 New features

- Add `groups` option to the `submit` command. ([#2891](https://github.com/expo/eas-cli/pull/2891) by [@khamilowicz](https://github.com/khamilowicz))

### 🐛 Bug fixes

- [eas-cli] Ensure workflow:runs returns most recent runs. ([#3045](https://github.com/expo/eas-cli/pull/3045) by [@douglowder](https://github.com/douglowder))

## [16.8.0](https://github.com/expo/eas-cli/releases/tag/v16.8.0) - 2025-06-04

### 🎉 New features

- [eas-cli] Add workflow:list and workflow:runs. ([#3030](https://github.com/expo/eas-cli/pull/3030) by [@douglowder](https://github.com/douglowder))

### 🧹 Chores

- Change location of EAS Update host override config. ([#3042](https://github.com/expo/eas-cli/pull/3042) by [@wschurman](https://github.com/wschurman))

## [16.7.2](https://github.com/expo/eas-cli/releases/tag/v16.7.2) - 2025-06-03

### 🐛 Bug fixes

- Add support for array `flavorDimensions` (`flavorDimensions = ['version']`). ([#3043](https://github.com/expo/eas-cli/pull/3043) by [@sjchmiela](https://github.com/sjchmiela))

## [16.7.1](https://github.com/expo/eas-cli/releases/tag/v16.7.1) - 2025-06-03

### 🐛 Bug fixes

- Fix some unit tests by updating mocks. ([#3035](https://github.com/expo/eas-cli/pull/3035) by [@douglowder](https://github.com/douglowder))
- Fix update republishing not including environment or git info. ([#3036](https://github.com/expo/eas-cli/pull/3036) by [@wschurman](https://github.com/wschurman))
- Do not require `eas.json` or `package.json` files when creating new workflow runs. ([#3028](https://github.com/expo/eas-cli/pull/3028) by [@sjchmiela](https://github.com/sjchmiela))
- Add `EAS_SKIP_CLI_VERSION_CHECK` allowing us to skip `eas-cli` version check (against `eas.json#version`). ([#3041](https://github.com/expo/eas-cli/pull/3041) by [@sjchmiela](https://github.com/sjchmiela))

## [16.7.0](https://github.com/expo/eas-cli/releases/tag/v16.7.0) - 2025-05-29

### 🎉 New features

- Add support for manifest host and asset host overriding for EAS Update. ([#3021](https://github.com/expo/eas-cli/pull/3021) by [@wschurman](https://github.com/wschurman))
- Add rollout flag to update:republish. ([#3029](https://github.com/expo/eas-cli/pull/3029) by [@quinlanj](https://github.com/quinlanj))

## [16.6.2](https://github.com/expo/eas-cli/releases/tag/v16.6.2) - 2025-05-23

### 🧹 Chores

- Further no longer require owner field for SDK >= 53 or canary. ([#3017](https://github.com/expo/eas-cli/pull/3017) by [@wschurman](https://github.com/wschurman))

## [16.6.1](https://github.com/expo/eas-cli/releases/tag/v16.6.1) - 2025-05-14

### 🐛 Bug fixes

- Onboarding: add cwd to spawned git process. ([#3015](https://github.com/expo/eas-cli/pull/3015) by [@quinlanj](https://github.com/quinlanj))

## [16.6.0](https://github.com/expo/eas-cli/releases/tag/v16.6.0) - 2025-05-14

### 🎉 New features

- Add support for uploading iOS internal distribution local builds. ([#3014](https://github.com/expo/eas-cli/pull/3014) by [@gabrieldonadel](https://github.com/gabrieldonadel))

## [16.5.0](https://github.com/expo/eas-cli/releases/tag/v16.5.0) - 2025-05-13

### 🎉 New features

- Add `--wait`/`--no-wait` flag to `eas workflow:run`. ([#3012](https://github.com/expo/eas-cli/pull/3012) by [@sjchmiela](https://github.com/sjchmiela))
- Add `--json` flag to `eas workflow:run`. ([#3013](https://github.com/expo/eas-cli/pull/3013) by [@sjchmiela](https://github.com/sjchmiela))

## [16.4.2](https://github.com/expo/eas-cli/releases/tag/v16.4.2) - 2025-05-10

### 🧹 Chores

- Update `eas-build-cache-provider` function names to use `buildCacheProvider` key. ([#3002](https://github.com/expo/eas-cli/pull/3002) by [@gabrieldonadel](https://github.com/gabrieldonadel))

## [16.4.1](https://github.com/expo/eas-cli/releases/tag/v16.4.1) - 2025-05-07

### 🧹 Chores

- Allow non-standard build types in custom gradle command. ([#3003](https://github.com/expo/eas-cli/pull/3003) by [@khamilowicz](https://github.com/khamilowicz))

## [16.4.0](https://github.com/expo/eas-cli/releases/tag/v16.4.0) - 2025-05-02

### 🎉 New features

- Add `--verbose-logs` flag for `build` command ([#3000](https://github.com/expo/eas-cli/pull/3000) by [@khamilowicz](https://github.com/khamilowicz))
- Add `eas-build-cache-provider` package. ([#3002](https://github.com/expo/eas-cli/pull/3002) by [@gabrieldonadel](https://github.com/gabrieldonadel))

### 🧹 Chores

- Read remote build cache provider types from `@expo/config`. ([#3005](https://github.com/expo/eas-cli/pull/3005) by [@gabrieldonadel](https://github.com/gabrieldonadel))

## [16.3.3](https://github.com/expo/eas-cli/releases/tag/v16.3.3) - 2025-04-24

### 🐛 Bug fixes

- Add `sdk-52` alias to the list or supported android images. ([#2989](https://github.com/expo/eas-cli/pull/2989) by [@kadikraman](https://github.com/kadikraman))
- Detect when expo metro config is used. ([#2996](https://github.com/expo/eas-cli/pull/2996) by [@kadikraman](https://github.com/kadikraman))

### 🧹 Chores

- upload assetmap.json when publishing update. ([#2994](https://github.com/expo/eas-cli/pull/2994) by [@quinlanj](https://github.com/quinlanj))
- Add error messages for CDN-level upload errors. ([#2998](https://github.com/expo/eas-cli/pull/2998) by [@kitten](https://github.com/kitten))

## [16.3.2](https://github.com/expo/eas-cli/releases/tag/v16.3.2) - 2025-04-17

### 🧹 Chores

- Update upload command to display build info. ([#2990](https://github.com/expo/eas-cli/pull/2990) by [@gabrieldonadel](https://github.com/gabrieldonadel))
- change launch asset file extension. ([#2991](https://github.com/expo/eas-cli/pull/2991) by [@quinlanj](https://github.com/quinlanj))

## [16.3.1](https://github.com/expo/eas-cli/releases/tag/v16.3.1) - 2025-04-11

### 🧹 Chores

- Add `--no-dev-client` flag for `build:download` command. ([#2985](https://github.com/expo/eas-cli/pull/2985) by [@gabrieldonadel](https://github.com/gabrieldonadel))

## [16.3.0](https://github.com/expo/eas-cli/releases/tag/v16.3.0) - 2025-04-09

### 🎉 New features

- Add `eas upload` command. ([#2932](https://github.com/expo/eas-cli/pull/2932), [#2981](https://github.com/expo/eas-cli/pull/2981), [#2983](https://github.com/expo/eas-cli/pull/2983) by [@gabrieldonadel](https://github.com/gabrieldonadel))
- Add `eas build:download` command. ([#2982](https://github.com/expo/eas-cli/pull/2982) by [@gabrieldonadel](https://github.com/gabrieldonadel))

## [16.2.2](https://github.com/expo/eas-cli/releases/tag/v16.2.2) - 2025-04-08

## [16.2.1](https://github.com/expo/eas-cli/releases/tag/v16.2.1) - 2025-04-04

### 🧹 Chores

- Bump `@expo/apple-utils` to use async JWT API. ([#2973](https://github.com/expo/eas-cli/pull/2973) by [@EvanBacon](https://github.com/EvanBacon))

## [16.2.0](https://github.com/expo/eas-cli/releases/tag/v16.2.0) - 2025-04-03

### 🎉 New features

- Add environment flag to `eas fingerprint:compare`. ([#2954](https://github.com/expo/eas-cli/pull/2954) by [@quinlanj](https://github.com/quinlanj))
- Add build-profile flag to `eas fingerprint:generate`. ([#2966](https://github.com/expo/eas-cli/pull/2966) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Remove hidden flag from `eas fingerprint:generate`. ([#2965](https://github.com/expo/eas-cli/pull/2965) by [@quinlanj](https://github.com/quinlanj))
- Refactor `eas update` command to improve code readability. ([#2976](https://github.com/expo/eas-cli/pull/2976) by [@quinlanj](https://github.com/quinlanj))
- `eas update`: add warning if no build exists with fingerprint. ([#2977](https://github.com/expo/eas-cli/pull/2977) by [@quinlanj](https://github.com/quinlanj))

## [16.1.0](https://github.com/expo/eas-cli/releases/tag/v16.1.0) - 2025-03-26

### 🎉 New features

- Add environment flag to `eas fingerprint:generate`. ([#2951](https://github.com/expo/eas-cli/pull/2951) by [@quinlanj](https://github.com/quinlanj))
- Add `corepack` field to `eas.json`. ([#2964](https://github.com/expo/eas-cli/pull/2964) by [@szdziedzic](https://github.com/szdziedzic))

## [16.0.1](https://github.com/expo/eas-cli/releases/tag/v16.0.1) - 2025-03-20

### 🐛 Bug fixes

- Make `eas update:configure` re-apply configuration from app.json /app.config.js when run multiple times. ([#2957](https://github.com/expo/eas-cli/pull/2957) by [@brentvatne](https://github.com/brentvatne))

## [16.0.0](https://github.com/expo/eas-cli/releases/tag/v16.0.0) - 2025-03-19

### 🛠 Breaking changes

- Add support for `.easignore` when `requireCommit` is set to `true`. ([#2942](https://github.com/expo/eas-cli/pull/2942) by [@sjchmiela](https://github.com/sjchmiela))
  - Up to 15.0.0, if `requireCommit` was `true`, `.easignore` was silently ignored.
  - Versions 15.0.0-15.0.13 started using `.easignore` to skip files from being bundled into a tarball when `requireCommit` was `true`. This was an unexpected change in behavior.
  - To clear this up, versions 15.0.13-15.0.15 were erroring if `.easignore` was present when `requireCommit` was `true`.
  - `eas-cli@16.0.0` formalizes the 15.0.0-15.0.13 behavior by adhering to `.easignore` even when `requireCommit` is set to `true`.
  - If you know what you're doing and you want to suppress a warning printed, you can do so by setting `EAS_SUPPRESS_REQUIRE_COMMIT_EASIGNORE_WARNING` environment variable to `true`.

### 🎉 New features

- Add requestId to ApiV2Error. ([#2941](https://github.com/expo/eas-cli/pull/2941) by [@wschurman](https://github.com/wschurman))
- Release `eas fingerprint:generate` in hidden mode ([#2937](https://github.com/expo/eas-cli/pull/2937) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Use correct logic to determine whether artifacts have expired in `eas build:run` command. ([#2931](https://github.com/expo/eas-cli/pull/2931) by [@szdziedzic](https://github.com/szdziedzic))

## [15.0.15](https://github.com/expo/eas-cli/releases/tag/v15.0.15) - 2025-03-12

### 🐛 Bug fixes

- Pass through the updates version to `setUpdatesConfigAsync`, which expects it in order to determine which field values to use. ([#2934](https://github.com/expo/eas-cli/pull/2934) by [@brentvatne](https://github.com/brentvatne)).

## [15.0.14](https://github.com/expo/eas-cli/releases/tag/v15.0.14) - 2025-03-06

### 🐛 Bug fixes

- In `EAS_NO_VCS=1`, use Git for repository root when `EAS_PROJECT_ROOT` is not set. ([#2901](https://github.com/expo/eas-cli/pull/2901) by [@sjchmiela](https://github.com/sjchmiela))

### 🧹 Chores

- Suggest using `eas build:dev` for matching configurations. ([#2929](https://github.com/expo/eas-cli/pull/2929) by [@szdziedzic](https://github.com/szdziedzic))

## [15.0.13](https://github.com/expo/eas-cli/releases/tag/v15.0.13) - 2025-03-04

### 🐛 Bug fixes

- Fixed `.git` being always unexpectedly removed if you had `requireCommit: true` and `.easignore` present. ([#2925](https://github.com/expo/eas-cli/pull/2925) by [@sjchmiela](https://github.com/sjchmiela))

### 🧹 Chores

- Fix `eas fingerprint:compare` URL generation and pretty prints. ([#2909](https://github.com/expo/eas-cli/pull/2909) by [@quinlanj](https://github.com/quinlanj))
- fix formatFields to handle empty array. ([#2914](https://github.com/expo/eas-cli/pull/2914) by [@quinlanj](https://github.com/quinlanj))
- fix git diff header in `fingerprint:compare`. ([#2915](https://github.com/expo/eas-cli/pull/2915) by [@quinlanj](https://github.com/quinlanj))
- amend fingerprint compare url. ([#2923](https://github.com/expo/eas-cli/pull/2923) by [@quinlanj](https://github.com/quinlanj))
- improve error message for `applicationIdSuffix`. ([#2924](https://github.com/expo/eas-cli/pull/2924) by [@kadikraman](https://github.com/kadikraman))

## [15.0.12](https://github.com/expo/eas-cli/releases/tag/v15.0.12) - 2025-02-22

### 🐛 Bug fixes

- Fix APNS key creation. ([#2916](https://github.com/expo/eas-cli/pull/2916) by [@EvanBacon](https://github.com/EvanBacon))

## [15.0.11](https://github.com/expo/eas-cli/releases/tag/v15.0.11) - 2025-02-21

### 🐛 Bug fixes

- Fix internal TestFlight group creation. ([#2906](https://github.com/expo/eas-cli/pull/2906) by [@EvanBacon](https://github.com/EvanBacon))

### 🧹 Chores

- Narrow amount of data queried for basic update channel operations. ([#2901](https://github.com/expo/eas-cli/pull/2901) by [@wschurman](https://github.com/wschurman))
- Fix `eas fingerprint:compare` description. ([#2908](https://github.com/expo/eas-cli/pull/2908) by [@quinlanj](https://github.com/quinlanj))
- Skip auto-creation of TestFlight group when there are already exisitng TestFlight groups and allow to opt out of the behavior by setting `EAS_NO_AUTO_TESTFLIGHT_SETUP` env var. ([#2856](https://github.com/expo/eas-cli/pull/2856) by [@szdziedzic](https://github.com/szdziedzic))

## [15.0.10](https://github.com/expo/eas-cli/releases/tag/v15.0.10) - 2025-02-11

### 🐛 Bug fixes

- Fix files deleted in working directory not being removed from the project archive when `requireCommit` is false. ([#2900](https://github.com/expo/eas-cli/pull/2900) by [@sjchmiela](https://github.com/sjchmiela))

## [15.0.9](https://github.com/expo/eas-cli/releases/tag/v15.0.9) - 2025-02-09

### 🐛 Bug fixes

- Fix files not being ignored when creating a tarball on Windows in Git repository in no `requireCommit` mode. ([#2894](https://github.com/expo/eas-cli/pull/2894) by [@sjchmiela](https://github.com/sjchmiela))

## [15.0.8](https://github.com/expo/eas-cli/releases/tag/v15.0.8) - 2025-02-09

## [15.0.7](https://github.com/expo/eas-cli/releases/tag/v15.0.7) - 2025-02-09

## [15.0.6](https://github.com/expo/eas-cli/releases/tag/v15.0.6) - 2025-02-07

## [15.0.5](https://github.com/expo/eas-cli/releases/tag/v15.0.5) - 2025-02-06

### 🐛 Bug fixes

- Do not copy files over onto a cloned Git repository when packing the project archive if `requireCommit` is true. ([#2885](https://github.com/expo/eas-cli/pull/2885) by [@sjchmiela](https://github.com/sjchmiela))
- Fix `EISDIR` error when archiving project with submodules ignored. ([#2884](https://github.com/expo/eas-cli/pull/2884) by [@sjchmiela](https://github.com/sjchmiela))

## [15.0.4](https://github.com/expo/eas-cli/releases/tag/v15.0.4) - 2025-02-05

### 🐛 Bug fixes

- Fixed `GitClient` not respecting `.easignore` file. ([#2873](https://github.com/expo/eas-cli/pull/2873) by [@sjchmiela](https://github.com/sjchmiela))
- Fix symlink support in `makeShallowCopyAsync`. ([#2874](https://github.com/expo/eas-cli/pull/2874) by [@sjchmiela](https://github.com/sjchmiela))
- Allow excluding `.git` directory from project archive by adding it to `.easignore`. ([#2879](https://github.com/expo/eas-cli/pull/2879) by [@sjchmiela](https://github.com/sjchmiela))

### 🧹 Chores

- Popup website in fingerprint:compare. ([#2859](https://github.com/expo/eas-cli/pull/2859) by [@quinlanj](https://github.com/quinlanj))
- Fix fingerprint:compare URL. ([#2861](https://github.com/expo/eas-cli/pull/2861) by [@quinlanj](https://github.com/quinlanj))
- Make less gql calls in fingerprint:compare. ([#2860](https://github.com/expo/eas-cli/pull/2860) by [@quinlanj](https://github.com/quinlanj))
- No longer require owner field for SDK >= 53 or canary. ([#2835](https://github.com/expo/eas-cli/pull/2835) by [@wschurman](https://github.com/wschurman))
- Add --open flag to fingerprint:compare. ([#2872](https://github.com/expo/eas-cli/pull/2872) by [@quinlanj](https://github.com/quinlanj))

## [15.0.3](https://github.com/expo/eas-cli/releases/tag/v15.0.3) - 2025-02-04

### 🐛 Bug fixes

- Fixed EAS server environment variables does not pass to `npx expo-updates runtimeversion:resolve` call. ([#2867](https://github.com/expo/eas-cli/pull/2867) by [@kudo](https://github.com/kudo))

## [15.0.2](https://github.com/expo/eas-cli/releases/tag/v15.0.2) - 2025-02-04

## [15.0.1](https://github.com/expo/eas-cli/releases/tag/v15.0.1) - 2025-02-04

## [15.0.0](https://github.com/expo/eas-cli/releases/tag/v15.0.0) - 2025-02-04

### 🛠 Breaking changes

- Use Git to archive projects containing a Git repository. (Previously, Git would only be used if `requireCommit` flag in `eas.json` was set to `true`.) ([#2841](https://github.com/expo/eas-cli/pull/2841) by [@sjchmiela](https://github.com/sjchmiela))

### 🐛 Bug fixes

- Print warning for `NoVcsClient` only once. ([#2863](https://github.com/expo/eas-cli/pull/2863) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Add update support for fingerprint:compare. ([#2850](https://github.com/expo/eas-cli/pull/2850) by [@quinlanj](https://github.com/quinlanj))
- Add update group id support for fingerprint:compare. ([#2851](https://github.com/expo/eas-cli/pull/2851) by [@quinlanj](https://github.com/quinlanj))
- Add better interactive support for fingerprint:compare. ([#2854](https://github.com/expo/eas-cli/pull/2854) by [@quinlanj](https://github.com/quinlanj))

## [14.7.1](https://github.com/expo/eas-cli/releases/tag/v14.7.1) - 2025-01-31

### 🐛 Bug fixes

- Account for `ios.config.usesNonExemptEncryption` in non-exempt encryption status prompt. ([#2852](https://github.com/expo/eas-cli/pull/2852) by [@EvanBacon](https://github.com/EvanBacon))

## [14.7.0](https://github.com/expo/eas-cli/releases/tag/v14.7.0) - 2025-01-30

### 🎉 New features

- Add `--submit` and `-s` as aliases for `--auto-submit` flag. ([#2846](https://github.com/expo/eas-cli/pull/2846) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Skip non-exempt check in non-interactive mode. ([#2849](https://github.com/expo/eas-cli/pull/2849) by [@EvanBacon](https://github.com/EvanBacon))

## [14.6.0](https://github.com/expo/eas-cli/releases/tag/v14.6.0) - 2025-01-30

### 🎉 New features

- Prompt to set non-exempt encryption status for the iOS app to support faster store submissions. ([#2843](https://github.com/expo/eas-cli/pull/2843) by [@EvanBacon](https://github.com/EvanBacon))
- Automatically create internal TestFlight group in EAS Submit command. ([#2839](https://github.com/expo/eas-cli/pull/2839) by [@evanbacon](https://github.com/evanbacon))
- Sanitize and generate names for EAS Submit to prevent failures due to invalid characters or taken names. ([#2842](https://github.com/expo/eas-cli/pull/2842) by [@evanbacon](https://github.com/evanbacon))
- Release `eas fingerprint:compare`. ([#2821](https://github.com/expo/eas-cli/pull/2821) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Make new autoIncremented builds start at nr 1 by default ([#2828](https://github.com/expo/eas-cli/pull/2828) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

## [14.5.0](https://github.com/expo/eas-cli/releases/tag/v14.5.0) - 2025-01-22

### 🎉 New features

- Allow filtering by `--fingerprint_hash` in `eas build:list` command. ([#2818](https://github.com/expo/eas-cli/pull/2818) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Ensure that the AASA file is served with content type application/json ([#2829](https://github.com/expo/eas-cli/pull/2829) by [@kadikraman](https://github.com/kadikraman))
- Ensure that the AppleID provided in prompt or saved to cache does not contain invalid unprintable characters ([#2830](https://github.com/expo/eas-cli/pull/2830) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🧹 Chores

- Fix logs typos in the `eas deploy` command. ([#2822](https://github.com/expo/eas-cli/pull/2822) by [@kadikraman](https://github.com/kadikraman))
- Make `deploy` the top level command for hosting. ([#2824](https://github.com/expo/eas-cli/pull/2824) by [@kadikraman](https://github.com/kadikraman))
- Allow longer submit profile extension chain (up to 5, same as build profile) ([#2831](https://github.com/expo/eas-cli/pull/2831) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Make variable naming more explicit, remove deprecated runtimeFingerprintSource uses. ([#2816](https://github.com/expo/eas-cli/pull/2816) by [@wschurman](https://github.com/wschurman))

## [14.4.1](https://github.com/expo/eas-cli/releases/tag/v14.4.1) - 2025-01-15

### 🐛 Bug fixes

- Enable shell execution for env:exec commands. ([#2788](https://github.com/expo/eas-cli/pull/2788) by [@tharakadesilva](https://github.com/tharakadesilva))

### 🧹 Chores

- Make automatic env resolution message shorter. ([#2806](https://github.com/expo/eas-cli/pull/2806) by [@szdziedzic](https://github.com/szdziedzic))
- Make "No remote versions are configured" message green instead of yellow. ([#2805](https://github.com/expo/eas-cli/pull/2805) by [@szdziedzic](https://github.com/szdziedzic))
- Upload local fingerprint on `eas fingerprint:compare`. ([#2808](https://github.com/expo/eas-cli/pull/2808) by [@quinlanj](https://github.com/quinlanj))
- Upgrade `eas-cli-local-build-plugin` to `1.0.163` to support Bun's new text-based lock file in local builds. ([#2817](https://github.com/expo/eas-cli/pull/2817) by [@shiroyasha9](https://github.com/shiroyasha9))

## [14.4.0](https://github.com/expo/eas-cli/releases/tag/v14.4.0) - 2025-01-09

### 🎉 New features

- Load `.env` variables even when `--environment` is specified for `deploy` command. Conflicts will be highlighted by a warning message. ([#2783](https://github.com/expo/eas-cli/pull/2783) by [@kitten](https://github.com/kitten))
- Silence all non-command output in non-interactive mode of eas env:exec. ([#2800](https://github.com/expo/eas-cli/pull/2800) by [@wschurman](https://github.com/wschurman))
- Unhide `deploy` and `deploy:alias` commands ([#2807](https://github.com/expo/eas-cli/pull/2807) by [@kitten](https://github.com/kitten))

## [14.3.1](https://github.com/expo/eas-cli/releases/tag/v14.3.1) - 2025-01-08

### 🧹 Chores

- Bump `@expo/package-manager@1.7.0` to support Bun text-based lock files. ([#2801](https://github.com/expo/eas-cli/pull/2801) by [@kudo](https://github.com/kudo))

## [14.3.0](https://github.com/expo/eas-cli/releases/tag/v14.3.0) - 2025-01-07

### 🎉 New features

- Upload `package.json` when uploading workflow sources. ([#2786](https://github.com/expo/eas-cli/pull/2786) by [@sjchmiela](https://github.com/sjchmiela))

### 🐛 Bug fixes

- Show `eas deploy` upload error messages. ([#2771](https://github.com/expo/eas-cli/pull/2771) by [@kadikraman](https://github.com/kadikraman))
- Prevent EAS CLI dependencies check from running repeatedly. ([#2781](https://github.com/expo/eas-cli/pull/2781) by [@kitten](https://github.com/kitten))
- Prevent optimistic request body parsing for `eas deploy`. ([#2784](https://github.com/expo/eas-cli/pull/2784) by [@kadikraman](https://github.com/kadikraman))

### 🧹 Chores

- Update log output for `worker` deploy and alias commands. ([#2780](https://github.com/expo/eas-cli/pull/2780) by [@kitten](https://github.com/kitten))
- Update various messages wording. ([#2790](https://github.com/expo/eas-cli/pull/2790) by [@simek](https://github.com/simek))
- Use node18 as tsconfig base. ([#2739](https://github.com/expo/eas-cli/pull/2739) by [@quinlanj](https://github.com/quinlanj))

## [14.2.0](https://github.com/expo/eas-cli/releases/tag/v14.2.0) - 2024-12-13

### 🎉 New features

- Add `eas deploy --dry-run` flag to output tarball. ([#2761](https://github.com/expo/eas-cli/pull/2761) by [@kitten](https://github.com/kitten))
- Allow specifying credentials for android builds. ([#2775](https://github.com/expo/eas-cli/pull/2775) by [@khamilowicz](https://github.com/khamilowicz))

### 🐛 Bug fixes

- Remove random branch name generation for --auto branch name non-vcs fallback. ([#2747](https://github.com/expo/eas-cli/pull/2747) by [@wschurman](https://github.com/wschurman))
- Upgrade @expo/multipart-body-parser. ([#2751](https://github.com/expo/eas-cli/pull/2751) by [@wschurman](https://github.com/wschurman))
- Pass env var flag to worker deployments. ([#2763](https://github.com/expo/eas-cli/pull/2763) by [@kadikraman](https://github.com/kadikraman))
- Fix request for switching providers when doing Apple auth. ([#2769](https://github.com/expo/eas-cli/pull/2769) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Improve logging and validation in `eas env:exec` command. ([#2762](https://github.com/expo/eas-cli/pull/2762) by [@szdziedzic](https://github.com/szdziedzic))

## [14.1.0](https://github.com/expo/eas-cli/releases/tag/v14.1.0) - 2024-12-10

### 🎉 New features

- Add support for enabeling broadcast Push Notifications capability option, by setting `ios.usesBroadcastPushNotifications` to `true` in app config. ([#2748](https://github.com/expo/eas-cli/pull/2748) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Add link to FYI page mentioning the workaround for Apple SMS 2FA issue. ([#2752](https://github.com/expo/eas-cli/pull/2752) by [@szdziedzic](https://github.com/szdziedzic))

## [14.0.3](https://github.com/expo/eas-cli/releases/tag/v14.0.3) - 2024-12-09

### 🐛 Bug fixes

- Bump `@expo/apple-utils` to fix sending two-factor authentication codes via SMS. ([#2750](https://github.com/expo/eas-cli/pull/2750) by [@EvanBacon](https://github.com/EvanBacon))

### 🧹 Chores

- Change update message to allow faster copy and paste. ([#2661](https://github.com/expo/eas-cli/pull/2661) by [@jonluca](https://github.com/jonluca))
- Allow using `$schema` field in `eas.json`. ([#2624](https://github.com/expo/eas-cli/pull/2624) by [@saiichihashimoto](https://github.com/saiichihashimoto))

## [14.0.2](https://github.com/expo/eas-cli/releases/tag/v14.0.2) - 2024-12-06

### 🧹 Chores

- Print warning instead of throwing an error when validating `CFBundleShortVersionString` against App Store requirements. ([#2741](https://github.com/expo/eas-cli/pull/2741) by [@szdziedzic](https://github.com/szdziedzic))

## [14.0.1](https://github.com/expo/eas-cli/releases/tag/v14.0.1) - 2024-12-06

### 🧹 Chores

- Bump `@expo/apple-utils` to improve error handling and input validation and change auth headers. ([#2745](https://github.com/expo/eas-cli/pull/2745) by [@szdziedzic](https://github.com/szdziedzic))

## [14.0.0](https://github.com/expo/eas-cli/releases/tag/v14.0.0) - 2024-12-06

### 🛠 Breaking changes

- Change behavior of roll-back-to-embedded to not use current project state. ([#2722](https://github.com/expo/eas-cli/pull/2722) by [@wschurman](https://github.com/wschurman))

### 🎉 New features

- Add hidden fingerprint:compare feature. ([#2736](https://github.com/expo/eas-cli/pull/2736) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Update `@expo/config` and `@expo/config-plugins` to fix `eas build` command for bare iOS projects on Windows. ([#2744](https://github.com/expo/eas-cli/pull/2744) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Fix outdated gitignored Google services file warning. ([#2730](https://github.com/expo/eas-cli/pull/2730) by [@szdziedzic](https://github.com/szdziedzic))

## [13.4.2](https://github.com/expo/eas-cli/releases/tag/v13.4.2) - 2024-11-25

### 🧹 Chores

- Upgrade `@expo` packages to SDK 52 versions. ([#2706](https://github.com/expo/eas-cli/pull/2706) by [@szdziedzic](https://github.com/szdziedzic))

## [13.4.1](https://github.com/expo/eas-cli/releases/tag/v13.4.1) - 2024-11-22

### 🧹 Chores

- Improve logging in `eas env:pull`. ([#2720](https://github.com/expo/eas-cli/pull/2720) by [@szdziedzic](https://github.com/szdziedzic))

## [13.4.0](https://github.com/expo/eas-cli/releases/tag/v13.4.0) - 2024-11-22

### 🎉 New features

- Calculate fingerprint on each update. ([#2687](https://github.com/expo/eas-cli/pull/2687) by [@quinlanj](https://github.com/quinlanj))
- Calculate fingerprint on each update republish. ([#2708](https://github.com/expo/eas-cli/pull/2708) by [@quinlanj](https://github.com/quinlanj))
- Add `eas env` commands. ([#2711](https://github.com/expo/eas-cli/pull/2711) by [@szdziedzic](https://github.com/szdziedzic))
- Add `--environment` flag to `eas update` command. ([#2711](https://github.com/expo/eas-cli/pull/2711) by [@szdziedzic](https://github.com/szdziedzic))
- Load readable environment variables from EAS servers on every build. ([#2644](https://github.com/expo/eas-cli/pull/2644) by [@szdziedzic](https://github.com/szdziedzic))
- Add environment field to `eas.schema.json`. ([#2719](https://github.com/expo/eas-cli/pull/2719) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Deprecate `eas secret` commands. ([#2705](https://github.com/expo/eas-cli/pull/2705) by [@szdziedzic](https://github.com/szdziedzic))

## [13.3.0](https://github.com/expo/eas-cli/releases/tag/v13.3.0) - 2024-11-18

### 🎉 New features

- Added `eas workflow` commands. [#2650](https://github.com/expo/eas-cli/pull/2650), [#2669](https://github.com/expo/eas-cli/pull/2669), [#2678](https://github.com/expo/eas-cli/pull/2678) by [@jonsamp](https://github.com/jonsamp) and [@sjchmiela](https://github.com/sjchmiela) ([#2683](https://github.com/expo/eas-cli/pull/2683) by [@sjchmiela](https://github.com/sjchmiela))

## [13.2.3](https://github.com/expo/eas-cli/releases/tag/v13.2.3) - 2024-11-15

## [13.2.2](https://github.com/expo/eas-cli/releases/tag/v13.2.2) - 2024-11-15

## [13.2.1](https://github.com/expo/eas-cli/releases/tag/v13.2.1) - 2024-11-14

## [13.2.0](https://github.com/expo/eas-cli/releases/tag/v13.2.0) - 2024-11-13

### 🎉 New features

- Add EAS_SKIP_AUTO_FINGERPRINT to skip fingerprint computation on build ([#2675](https://github.com/expo/eas-cli/pull/2675) by [@quinlanj](https://github.com/quinlanj))
- Default build-logger-level to debug when EXPO_DEBUG is set. ([#2676](https://github.com/expo/eas-cli/pull/2676) by [@wschurman](https://github.com/wschurman))

## [13.1.1](https://github.com/expo/eas-cli/releases/tag/v13.1.1) - 2024-11-08

## [13.1.0](https://github.com/expo/eas-cli/releases/tag/v13.1.0) - 2024-11-07

### 🎉 New features

- Compute fingerprint for builds with SDK 52 and higher ([#2663](https://github.com/expo/eas-cli/pull/2663) by [@quinlanj](https://github.com/quinlanj))

## [13.0.1](https://github.com/expo/eas-cli/releases/tag/v13.0.1) - 2024-11-05

### 🧹 Chores

- Upgrade EAS Metadata with new properties from App Store. ([#2671](https://github.com/expo/eas-cli/pull/2671) by [@byCedric](https://github.com/byCedric))

## [13.0.0](https://github.com/expo/eas-cli/releases/tag/v13.0.0) - 2024-11-05

### 🛠 Breaking changes

- Resolve versioned expo config using `npx expo config` command instead of using fixed `@expo/config` version shipped with EAS CLI, if available. ([#2529](https://github.com/expo/eas-cli/pull/2529) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Add `macos-sonoma-14.6-xcode-16.1` image and `sdk-52` image tag to `eas.schema.json`. ([#2666](https://github.com/expo/eas-cli/pull/2666) by [@szdziedzic](https://github.com/szdziedzic))
- Update `@expo` packages versions. ([#2530](https://github.com/expo/eas-cli/pull/2530) by [@szdziedzic](https://github.com/szdziedzic))

## [12.6.2](https://github.com/expo/eas-cli/releases/tag/v12.6.2) - 2024-10-29

### 🐛 Bug fixes

- Make email case insensitive during Apple authentication. ([#2659](https://github.com/expo/eas-cli/pull/2659) by [@byCedric](https://github.com/byCedric))

## [12.6.1](https://github.com/expo/eas-cli/releases/tag/v12.6.1) - 2024-10-25

### 🧹 Chores

- Create dynamic logged in context field and clean up erroneous SessionManager context field uses. ([#2648](https://github.com/expo/eas-cli/pull/2648) by [@wschurman](https://github.com/wschurman))

## [12.6.0](https://github.com/expo/eas-cli/releases/tag/v12.6.0) - 2024-10-21

### 🎉 New features

- Add `eas channel:pause` and `eas channel:resume` commands to pause/resume update delivery to builds using specific update channels and display paused status in channel details output. ([#2614](https://github.com/expo/eas-cli/pull/2614) by [@fiberjw](https://github.com/fiberjw))
- Add interactivity to eas update:edit command. ([#2638](https://github.com/expo/eas-cli/pull/2638) by [@wschurman](https://github.com/wschurman))

## [12.5.4](https://github.com/expo/eas-cli/releases/tag/v12.5.4) - 2024-10-19

## [12.5.3](https://github.com/expo/eas-cli/releases/tag/v12.5.3) - 2024-10-16

## [12.5.2](https://github.com/expo/eas-cli/releases/tag/v12.5.2) - 2024-10-11

### 🐛 Bug fixes

- Disallow republishing an update that is being rolled-out. ([#2602](https://github.com/expo/eas-cli/pull/2602) by [@wschurman](https://github.com/wschurman))
- Bump `@expo/apple-utils` to `2.0.2` resolving the Apple authentication error. ([#2641](https://github.com/expo/eas-cli/pull/2641) by [@byCedric](https://github.com/byCedric))

### 🧹 Chores

- Implement new `worker` deploy API flow. ([#2601](https://github.com/expo/eas-cli/pull/2601) by [@kitten](https://github.com/kitten)))
- Unhide rollout-percentage flag on update publish command. ([#2608](https://github.com/expo/eas-cli/pull/2608) by [@wschurman](https://github.com/wschurman))
- Let folks know about the new concurrency add-on ([#2611](https://github.com/expo/eas-cli/pull/2611) by [@brentvatne](https://github.com/brentvatne))

## [12.5.1](https://github.com/expo/eas-cli/releases/tag/v12.5.1) - 2024-09-27

### 🐛 Bug fixes

- Support assigning dev domain names in non interactive mode. ([#2595](https://github.com/expo/eas-cli/pull/2595) by [@byCedric](https://github.com/byCedric))

### 🧹 Chores

- Simplify the output of `eas deploy --json`. ([#2596](https://github.com/expo/eas-cli/pull/2596) by [@byCedric](https://github.com/byCedric))
- Support deploying Expo Router server exports without client directory. ([#2597](https://github.com/expo/eas-cli/pull/2597) by [@byCedric](https://github.com/byCedric))
- Add exit option to `eas credentials` interactive menu. ([#2570](https://github.com/expo/eas-cli/pull/2570) by [@szdziedzic](https://github.com/szdziedzic))

## [12.5.0](https://github.com/expo/eas-cli/releases/tag/v12.5.0) - 2024-09-23

### 🎉 New features

- Log command execution to assist in debugging local builds. ([#2526](https://github.com/expo/eas-cli/pull/2526) by [@trajano](https://github.com/trajano))
- Allow submitting builds in progress ([#2543](https://github.com/expo/eas-cli/pull/2543) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Use `EAS_DANGEROUS_OVERRIDE_ANDROID_APPLICATION_ID` and `EAS_DANGEROUS_OVERRIDE_IOS_BUNDLE_IDENTIFIER` environment variables as overrides of the Android application ID and iOS bundle identifier in managed workflow too. ([#2576](https://github.com/expo/eas-cli/pull/2576) by [@sjchmiela](https://github.com/sjchmiela))
- Add destination branch arguments to update:republish command. ([#2575](https://github.com/expo/eas-cli/pull/2575) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Avoid malforming `app.json` with empty `.expo` object. ([#2573](https://github.com/expo/eas-cli/pull/2573) by [@byCedric](https://github.com/byCedric))
- Fix typo causing `worker:deploy` asset upload errors not to be shown properly. ([#2579](https://github.com/expo/eas-cli/pull/2579) by [@kitten](https://github.com/kitten))

## [12.4.1](https://github.com/expo/eas-cli/releases/tag/v12.4.1) - 2024-09-14

## [12.4.0](https://github.com/expo/eas-cli/releases/tag/v12.4.0) - 2024-09-14

### 🎉 New features

- Add `worker:alias` command to assign aliases from the CLI. ([#2548](https://github.com/expo/eas-cli/pull/2548) by [@byCedric](https://github.com/byCedric))
- Add `worker --prod` flag to deploy to production from the CLI. ([#2550](https://github.com/expo/eas-cli/pull/2550) by [@byCedric](https://github.com/byCedric))
- Add `worker --alias` flag to assign custom aliases when deploying. ([#2551](https://github.com/expo/eas-cli/pull/2551) by [@byCedric](https://github.com/byCedric)))
- Add `worker --id` flag to use a custom deployment identifier. ([#2552](https://github.com/expo/eas-cli/pull/2552) by [@byCedric](https://github.com/byCedric)))
- Add `worker --environment` flag to deploy with EAS environment variables. ([#2557](https://github.com/expo/eas-cli/pull/2557) by [@kitten](https://github.com/kitten)))
- Add `worker --export-dir` flag to select exported directory. ([#2560](https://github.com/expo/eas-cli/pull/2560) by [@byCedric](https://github.com/byCedric)))
- Add `worker --json` flag to allow integrating with 3rd parties and custom tooling. ([#2561](https://github.com/expo/eas-cli/pull/2561) by [@byCedric](https://github.com/byCedric)))
- Add `worker:alias --json` flag to allow integrating with 3rd parties and custom tooling. ([#2562](https://github.com/expo/eas-cli/pull/2562) by [@byCedric](https://github.com/byCedric)))

### 🐛 Bug fixes

- Avoid merging `expo.extra` plugin-generated data with `expo.extra.eas.projectId` in `eas init`. ([#2554](https://github.com/expo/eas-cli/pull/2554) by [@byCedric](https://github.com/byCedric)))
- Restore "export not found" error and hide recent export timestamps. ([#2566](https://github.com/expo/eas-cli/pull/2566) by [@byCedric](https://github.com/byCedric)))
- Check if export is available before validating project ID in `eas worker`. ([#2569](https://github.com/expo/eas-cli/pull/2569) by [@byCedric](https://github.com/byCedric)))

### 🧹 Chores

- Make error message for invalid CFBundleShortVersionString more descriptive and actionable. Improve CFBundleShortVersionString validation regex. ([#2542](https://github.com/expo/eas-cli/pull/2542) by [@szdziedzic](https://github.com/szdziedzic))
- Add missing `--non-interactive` argument to `worker:deploy` command. ([#2544](https://github.com/expo/eas-cli/pull/2544) by [@kitten](https://github.com/kitten))
- Source `@expo/env` dotenv files for worker deployments. ([#2545](https://github.com/expo/eas-cli/pull/2545) by [@kitten](https://github.com/kitten))
- Support `worker --production` and clean up command output. ([#2555](https://github.com/expo/eas-cli/pull/2555) by [@byCedric](https://github.com/byCedric)))
- Unify both `worker` and `worker:alias` command output. ([#2558](https://github.com/expo/eas-cli/pull/2558) by [@byCedric](https://github.com/byCedric)))
- Share similar table/json output in both `worker` and `worker:alias` command outputs. ([#2563](https://github.com/expo/eas-cli/pull/2563) by [@byCedric](https://github.com/byCedric)))
- Polish the project URL prompt when setting up new projects. ([#2564](https://github.com/expo/eas-cli/pull/2564) by [@byCedric](https://github.com/byCedric)))
- Always assume `static` exports in `eas deploy` and add modified time. ([#2565](https://github.com/expo/eas-cli/pull/2565) by [@byCedric](https://github.com/byCedric)))
- Update the `eas worker --help` `--environment` description. ([#2567](https://github.com/expo/eas-cli/pull/2567) by [@byCedric](https://github.com/byCedric)))
- Remove the cursor space after selecting project dev domain. ([#2568](https://github.com/expo/eas-cli/pull/2568) by [@byCedric](https://github.com/byCedric)))
- Reword the dev domain prompt to mention "preview URL". ([#2572](https://github.com/expo/eas-cli/pull/2572) by [@byCedric](https://github.com/byCedric)))

## [12.3.0](https://github.com/expo/eas-cli/releases/tag/v12.3.0) - 2024-09-09

### 🎉 New features

- Add `--non-interactive` and `--force` support when `--id` is not passed to the `eas init` command. ([#1983](https://github.com/expo/eas-cli/pull/1983) by [@mymattcarroll](https://github.com/mymattcarroll))

## [12.1.1](https://github.com/expo/eas-cli/releases/tag/v12.1.1) - 2024-09-09

### 🐛 Bug fixes

- Fixed an issue where extensions retrieved the main app's entitlements instead of their own. ([#2532](https://github.com/expo/eas-cli/pull/2532) by [@HarrisHan](https://github.com/HarrisHan))

## [12.1.0](https://github.com/expo/eas-cli/releases/tag/v12.1.0) - 2024-09-06

### 🎉 New features

- **Internal/Experimental:** Add EAS Worker command ([#2447](https://github.com/expo/eas-cli/pull/2447) by [@kitten](https://github.com/kitten))
- Upload fingeprint source as part of eas update command. ([#2533](https://github.com/expo/eas-cli/pull/2533) by [@wschurman](https://github.com/wschurman))

## [12.0.0](https://github.com/expo/eas-cli/releases/tag/v12.0.0) - 2024-09-04

### 🛠 Breaking changes

- Prompt the users to set `appVersionSource`, while mentioning that `remote` is the default. ([#2411](https://github.com/expo/eas-cli/pull/2411) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🎉 New features

- Add support for syncing Journaling Suggestions, Managed App Installation UI, and 5G Network Slicing capabilities. ([#2525](https://github.com/expo/eas-cli/pull/2525) by [@szdziedzic](https://github.com/szdziedzic))

## [11.0.3](https://github.com/expo/eas-cli/releases/tag/v11.0.3) - 2024-08-31

### 🐛 Bug fixes

- Revert config-related packages to SDK 50 version from SDK 51 version to fix broken entitlements behavior for older SDKs. ([#2524](https://github.com/expo/eas-cli/pull/2524) by [@szdziedzic](https://github.com/szdziedzic))

## [11.0.2](https://github.com/expo/eas-cli/releases/tag/v11.0.2) - 2024-08-27

### 🐛 Bug fixes

- Remove unncessary static project config context definition from `eas build` command context, to fix resolving dynamic projest ID and slug for dynamic app configs. ([#2521](https://github.com/expo/eas-cli/pull/2521) by [@szdziedzic](https://github.com/szdziedzic))

## [11.0.1](https://github.com/expo/eas-cli/releases/tag/v11.0.1) - 2024-08-26

### 🐛 Bug fixes

- Make `eas config` command not require authentication when running in `--eas-json-only` mode. ([#2517](https://github.com/expo/eas-cli/pull/2517) by [@szdziedzic](https://github.com/szdziedzic))

## [11.0.0](https://github.com/expo/eas-cli/releases/tag/v11.0.0) - 2024-08-26

### 🛠 Breaking changes

- Remove long-deprecated `eas update` flags. ([#2501](https://github.com/expo/eas-cli/pull/2501) by [@wschurman](https://github.com/wschurman))

### 🎉 New features

- Add new rollout update type for `eas update` and `eas update:edit`. ([#2502](https://github.com/expo/eas-cli/pull/2502), [#2503](https://github.com/expo/eas-cli/pull/2503) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Upgrade packages to SDK 51 release. ([#2498](https://github.com/expo/eas-cli/pull/2498) by [@wschurman](https://github.com/wschurman))
- Enable typescript linting and various lint rules. ([#2505](https://github.com/expo/eas-cli/pull/2505), [#2507](https://github.com/expo/eas-cli/pull/2507), [#2508](https://github.com/expo/eas-cli/pull/2508), [#2509](https://github.com/expo/eas-cli/pull/2509), [#2510](https://github.com/expo/eas-cli/pull/2510) by [@wschurman](https://github.com/wschurman))
- Include debug info in fingerprint metadata during build. ([#2513](https://github.com/expo/eas-cli/pull/2513) by [@wschurman](https://github.com/wschurman))

## [10.2.4](https://github.com/expo/eas-cli/releases/tag/v10.2.4) - 2024-08-19

## [10.2.3](https://github.com/expo/eas-cli/releases/tag/v10.2.3) - 2024-08-13

### 🧹 Chores

- Add support for `EAS_DANGEROUS_OVERRIDE_IOS_BUNDLE_IDENTIFIER` for bare workflow iOS builds. ([#2469](https://github.com/expo/eas-cli/pull/2469) by [@szdziedzic](https://github.com/szdziedzic))
- Update images list in `eas.schema.json` and warn users when using the deprecated Android images. ([#2450](https://github.com/expo/eas-cli/pull/2450) by [@szdziedzic](https://github.com/szdziedzic))

## [10.2.2](https://github.com/expo/eas-cli/releases/tag/v10.2.2) - 2024-07-31

### 🐛 Bug fixes

- Pass correct path to `vcsClient.isFileIgnoredAsync` check for monorepos to validate that custom build config file is not ignored. ([#2470](https://github.com/expo/eas-cli/pull/2470) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Bump asset upload timeout from 90 to 180 seconds. ([#2466](https://github.com/expo/eas-cli/pull/2466) by [@quinlanj](https://github.com/quinlanj))

## [10.2.1](https://github.com/expo/eas-cli/releases/tag/v10.2.1) - 2024-07-18

### 🧹 Chores

- Indicate if a user is logged in using `EXPO_TOKEN` when running `eas whoami` command. ([#2461](https://github.com/expo/eas-cli/pull/2461) by [@szdziedzic](https://github.com/szdziedzic))
- Throw error when `eas login` command is run with `EXPO_TOKEN` environment variable set. ([#2461](https://github.com/expo/eas-cli/pull/2461) by [@szdziedzic](https://github.com/szdziedzic))
- Check if user is already logged in when running `eas login` command. ([#2461](https://github.com/expo/eas-cli/pull/2461) by [@szdziedzic](https://github.com/szdziedzic))

## [10.2.0](https://github.com/expo/eas-cli/releases/tag/v10.2.0) - 2024-07-15

### 🎉 New features

- Added flag `--emit-metadata` to emit `eas-update-metadata.json` in the bundle folder with detailed information about the generated updates ([#2451](https://github.com/expo/eas-cli/pull/2451) by [@rainst](https://github.com/rainst))

### 🐛 Bug fixes

- Bump `@expo/apple-utils` version to use the fallback Apple Developer Portal domain on every internal server error. ([#2459](https://github.com/expo/eas-cli/pull/2459) by [@szdziedzic](https://github.com/szdziedzic))

## [10.1.1](https://github.com/expo/eas-cli/releases/tag/v10.1.1) - 2024-07-04

## [10.1.0](https://github.com/expo/eas-cli/releases/tag/v10.1.0) - 2024-07-02

### 🎉 New features

- Save local fingeprint sources during build. ([#2422](https://github.com/expo/eas-cli/pull/2422) by [@kadikraman](https://github.com/kadikraman))

## [10.0.3](https://github.com/expo/eas-cli/releases/tag/v10.0.3) - 2024-06-26

### 🧹 Chores

- Track usage of `--local` build mode in analytics. ([#2445](https://github.com/expo/eas-cli/pull/2445) by [@szdziedzic](https://github.com/szdziedzic))
- Remove any mentions of deleted Xcode < 15 images. ([#2438](https://github.com/expo/eas-cli/pull/2438) by [@szdziedzic](https://github.com/szdziedzic))

## [10.0.2](https://github.com/expo/eas-cli/releases/tag/v10.0.2) - 2024-06-17

### 🐛 Bug fixes

- Fix parsing of `build.gradle` file by `gradle-to-js` parser by filtering out empty single line comments. ([#2435](https://github.com/expo/eas-cli/pull/2435) by [@szdziedzic](https://github.com/szdziedzic))

## [10.0.1](https://github.com/expo/eas-cli/releases/tag/v10.0.1) - 2024-06-17

### 🧹 Chores

- Add clarification to private-key flag in command line help. ([#2432](https://github.com/expo/eas-cli/pull/2432) by [@quinlanj](https://github.com/quinlanj))

## [10.0.0](https://github.com/expo/eas-cli/releases/tag/v10.0.0) - 2024-06-13

### 🛠 Breaking changes

- Drop support for Node 16. ([#2413](https://github.com/expo/eas-cli/pull/2413) by [@byCedric](https://github.com/byCedric))
- Update [`eas-build`](https://github.com/expo/eas-build) dependencies to the version requiring Node 18 as minimal Node version. ([#2416](https://github.com/expo/eas-cli/pull/2416) by [@expo-bot](https://github.com/expo-bot))

### 🐛 Bug fixes

- Resolve correct submit profile configuration for `eas build` command with `--auto-submit-with-profile` flag. ([#2425](https://github.com/expo/eas-cli/pull/2425) by [@szdziedzic](https://github.com/szdziedzic))
- Correctly parse the EXPO_APPLE_PROVIER_ID environment variable. ([#2349](https://github.com/expo/eas-cli/pull/2349) by [@louix](https://github.com/louix))

### 🧹 Chores

- Update lockfile to only include `@types/node@20.11.0`. ([#2412](https://github.com/expo/eas-cli/pull/2412) by [@byCedric](https://github.com/byCedric))
- Update test workflow Node versions to 18, 20, and 22. ([#2413](https://github.com/expo/eas-cli/pull/2413) by [@byCedric](https://github.com/byCedric))

## [9.2.0](https://github.com/expo/eas-cli/releases/tag/v9.2.0) - 2024-06-06

### 🎉 New features

- Add `target-profile` and `source-profile` flags to the `eas build:resign` command. ([#2410](https://github.com/expo/eas-cli/pull/2410) by [@szdziedzic](https://github.com/szdziedzic))
- Display build profile in the output of `eas build:list`. ([#2408](https://github.com/expo/eas-cli/pull/2408) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Use the correct app config for no GitHub flow in `init:onboarding`. ([#2397](https://github.com/expo/eas-cli/pull/2397) by [@szdziedzic](https://github.com/szdziedzic))
- Disallow picking expired builds as submit archive source. ([#2406](https://github.com/expo/eas-cli/pull/2406) by [@sjchmiela](https://github.com/sjchmiela))

### 🧹 Chores

- Print network error message if present. ([#2407](https://github.com/expo/eas-cli/pull/2407) by [@szdziedzic](https://github.com/szdziedzic))
- Make flags for `eas build:list` command more aligned with flags for rest of the commands. ([#2409](https://github.com/expo/eas-cli/pull/2409) by [@szdziedzic](https://github.com/szdziedzic))

## [9.1.0](https://github.com/expo/eas-cli/releases/tag/v9.1.0) - 2024-05-23

### 🎉 New features

- Make `eas init:onboarding` command public. ([#2399](https://github.com/expo/eas-cli/pull/2399) by [@szdziedzic](https://github.com/szdziedzic))

## [9.0.10](https://github.com/expo/eas-cli/releases/tag/v9.0.10) - 2024-05-22

## [9.0.9](https://github.com/expo/eas-cli/releases/tag/v9.0.9) - 2024-05-22

## [9.0.8](https://github.com/expo/eas-cli/releases/tag/v9.0.8) - 2024-05-21

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2387](https://github.com/expo/eas-cli/pull/2387) by [@expo-bot](https://github.com/expo-bot))
- Improve displaying of device registration QR code. ([#2391](https://github.com/expo/eas-cli/pull/2391) by [@szdziedzic](https://github.com/szdziedzic))

## [9.0.7](https://github.com/expo/eas-cli/releases/tag/v9.0.7) - 2024-05-17

## [9.0.6](https://github.com/expo/eas-cli/releases/tag/v9.0.6) - 2024-05-15

## [9.0.5](https://github.com/expo/eas-cli/releases/tag/v9.0.5) - 2024-05-13

## [9.0.4](https://github.com/expo/eas-cli/releases/tag/v9.0.4) - 2024-05-13

### 🧹 Chores

- Add loader and progress information to the `diagnostics` command. ([#2378](https://github.com/expo/eas-cli/pull/2378) by [@simek](https://github.com/simek))

## [9.0.3](https://github.com/expo/eas-cli/releases/tag/v9.0.3) - 2024-05-10

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2372](https://github.com/expo/eas-cli/pull/2372) by [@expo-bot](https://github.com/expo-bot))

## [9.0.2](https://github.com/expo/eas-cli/releases/tag/v9.0.2) - 2024-05-09

## [9.0.1](https://github.com/expo/eas-cli/releases/tag/v9.0.1) - 2024-05-09

### 🧹 Chores

- Update image tags in `eas.schema.json`. ([#2363](https://github.com/expo/eas-cli/pull/2363) by [@szdziedzic](https://github.com/szdziedzic))

## [9.0.0](https://github.com/expo/eas-cli/releases/tag/v9.0.0) - 2024-05-08

### 🛠 Breaking changes

- Allow modification of provisioning profile in CI, add --freeze-credentials flag. ([#2347](https://github.com/expo/eas-cli/pull/2347) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Pass env from process.env and build profile to expo-updates CLI calls where applicable. ([#2359](https://github.com/expo/eas-cli/pull/2359) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Remove more classic updates code. ([#2357](https://github.com/expo/eas-cli/pull/2357) by [@wschurman](https://github.com/wschurman))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2360](https://github.com/expo/eas-cli/pull/2360) by [@expo-bot](https://github.com/expo-bot))
- Don't pass custom global `"expoCli"` version set in `eas.json` to EAS Build process and warn users when setting it. ([#2361](https://github.com/expo/eas-cli/pull/2361) by [@szdziedzic](https://github.com/szdziedzic))

## [8.0.0](https://github.com/expo/eas-cli/releases/tag/v8.0.0) - 2024-05-01

### 🛠 Breaking changes

- Stop creating a channel on `eas update` and `eas update:roll-back-to-embedded` unless the `--channel` flag is specified. ([#2346](https://github.com/expo/eas-cli/pull/2346) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Improve login info message for other login options. ([#2352](https://github.com/expo/eas-cli/pull/2352) by [@wschurman](https://github.com/wschurman))
- Show the -s, --sso option in the login command help. ([#2353](https://github.com/expo/eas-cli/pull/2353) by [@lzkb](https://github.com/lzkb))

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2351](https://github.com/expo/eas-cli/pull/2351) by [@expo-bot](https://github.com/expo-bot))
- Don't prompt users to set push notifications by default if they don't have the `expo-notifications` installed. ([#2343](https://github.com/expo/eas-cli/pull/2343) by [@szdziedzic](https://github.com/szdziedzic))

## [7.8.5](https://github.com/expo/eas-cli/releases/tag/v7.8.5) - 2024-04-26

### 🐛 Bug fixes

- Add explicit workflow arg to expo-update CLI calls. ([#2340](https://github.com/expo/eas-cli/pull/2340) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Improve error message if the server returns `UNAUTHORIZED_ERROR`. ([#2345](https://github.com/expo/eas-cli/pull/2345) by [@szdziedzic](https://github.com/szdziedzic))
- Fill in min expo-updates version for expo-updates CLI. ([#2344](https://github.com/expo/eas-cli/pull/2344) by [@wschurman](https://github.com/wschurman))

## [7.8.4](https://github.com/expo/eas-cli/releases/tag/v7.8.4) - 2024-04-24

### 🧹 Chores

- Update the list of available Android images. ([#2337](https://github.com/expo/eas-cli/pull/2337) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Make multi-select for revoking distribution certificates more readable. ([#2342](https://github.com/expo/eas-cli/pull/2342) by [@szdziedzic](https://github.com/szdziedzic))
- Improve error message displayed when EAS CLI version doesn't satisfy minimal version required specified in eas.json. ([#2341](https://github.com/expo/eas-cli/pull/2341) by [@szdziedzic](https://github.com/szdziedzic))

## [7.8.3](https://github.com/expo/eas-cli/releases/tag/v7.8.3) - 2024-04-23

### 🐛 Bug fixes

- Don't prompt to set `android.package` and `ios.bundleIdentifier` values when running in non-interactive mode. ([#2336](https://github.com/expo/eas-cli/pull/2336) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Amend credential removal wording. ([#2334](https://github.com/expo/eas-cli/pull/2334) by [@quinlanj](https://github.com/quinlanj))

## [7.8.2](https://github.com/expo/eas-cli/releases/tag/v7.8.2) - 2024-04-15

### 🐛 Bug fixes

- Fix display of errors when expo-updates CLI command fails. ([#2324](https://github.com/expo/eas-cli/pull/2324) by [@wschurman](https://github.com/wschurman))
- Move credentials endpoints to paginated counterparts. ([#2327](https://github.com/expo/eas-cli/pull/2327) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Add progress bar for fetching paginated datasets. ([#2326](https://github.com/expo/eas-cli/pull/2326) by [@quinlanj](https://github.com/quinlanj))

## [7.8.1](https://github.com/expo/eas-cli/releases/tag/v7.8.1) - 2024-04-11

### 🐛 Bug fixes

- Fix command source files URLs in autogenerated `README`. ([#2318](https://github.com/expo/eas-cli/pull/2318) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2316](https://github.com/expo/eas-cli/pull/2316) by [@expo-bot](https://github.com/expo-bot))
- Stop querying `Build.resourceClass` field. ([#2320](https://github.com/expo/eas-cli/pull/2320) by [@szdziedzic](https://github.com/szdziedzic))

## [7.8.0](https://github.com/expo/eas-cli/releases/tag/v7.8.0) - 2024-04-08

### 🎉 New features

- Add `auto`, `sdk-50` and `sdk-49` image tags. ([#2298](https://github.com/expo/eas-cli/pull/2298) by [@szdziedzic](https://github.com/szdziedzic))
- Add `--build-logger-level` flag to `eas build` command. ([#2313](https://github.com/expo/eas-cli/pull/2313) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Deprecate the `default` image tag. ([#2298](https://github.com/expo/eas-cli/pull/2298) by [@szdziedzic](https://github.com/szdziedzic))
- Deprecate iOS images with Xcode version lower then 15. ([#2298](https://github.com/expo/eas-cli/pull/2298) by [@szdziedzic](https://github.com/szdziedzic))

## [7.7.0](https://github.com/expo/eas-cli/releases/tag/v7.7.0) - 2024-04-05

### 🎉 New features

- Generate metadata file for project archive ([#2149](https://github.com/expo/eas-cli/pull/2149) by [@khamilowicz](https://github.com/khamilowicz))
- Add --verbose-fastlane flag to eas submit command for more robust fastlane pilot logs. ([#2276](https://github.com/expo/eas-cli/pull/2276) by [@khamilowicz](https://github.com/khamilowicz))
- Add `eas credentials:configure-build` subcommand. ([#2282](https://github.com/expo/eas-cli/pull/2282) by [@fiberjw](https://github.com/fiberjw))

### 🧹 Chores

- Add info about the Xcode 15.3 image to `eas.schema.json`. ([#2312](https://github.com/expo/eas-cli/pull/2312) by [@szdziedzic](https://github.com/szdziedzic))

## [7.6.2](https://github.com/expo/eas-cli/releases/tag/v7.6.2) - 2024-03-27

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2301](https://github.com/expo/eas-cli/pull/2301) by [@expo-bot](https://github.com/expo-bot))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2304](https://github.com/expo/eas-cli/pull/2304) by [@expo-bot](https://github.com/expo-bot))

## [7.6.1](https://github.com/expo/eas-cli/releases/tag/v7.6.1) - 2024-03-25

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2291](https://github.com/expo/eas-cli/pull/2291) by [@expo-bot](https://github.com/expo-bot))
- Fix asset limit punctuation. ([#2296](https://github.com/expo/eas-cli/pull/2296) by [@quinlanj](https://github.com/quinlanj))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2293](https://github.com/expo/eas-cli/pull/2293) by [@expo-bot](https://github.com/expo-bot))

## [7.6.0](https://github.com/expo/eas-cli/releases/tag/v7.6.0) - 2024-03-18

### 🎉 New features

- Print uncommitted files in non-interactive mode if they fail the execution. ([#2288](https://github.com/expo/eas-cli/pull/2288) by [@sjchmiela](https://github.com/sjchmiela))

### 🐛 Bug fixes

- Use a custom build config path with POSIX separator when sending data to the EAS Build server. ([#2285](https://github.com/expo/eas-cli/pull/2285) by [@szdziedzic](https://github.com/szdziedzic))
- Improve resolving vcsClient as a part of the project context. ([#2295](https://github.com/expo/eas-cli/pull/2295) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2277](https://github.com/expo/eas-cli/pull/2277) by [@expo-bot](https://github.com/expo-bot))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2283](https://github.com/expo/eas-cli/pull/2283) by [@expo-bot](https://github.com/expo-bot))
- Bump the `@expo/apple-utils` version to switch between the `developer.apple.com` and `developer-mdn.apple.com` domains when one of them doesn't work. ([#2290](https://github.com/expo/eas-cli/pull/2290) by [@szdziedzic](https://github.com/szdziedzic))

## [7.5.0](https://github.com/expo/eas-cli/releases/tag/v7.5.0) - 2024-03-11

### 🎉 New features

- Add `--auto-submit` option to `eas build:internal` command. ([#2271](https://github.com/expo/eas-cli/pull/2271) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2274](https://github.com/expo/eas-cli/pull/2274) by [@expo-bot](https://github.com/expo-bot))

## [7.4.0](https://github.com/expo/eas-cli/releases/tag/v7.4.0) - 2024-03-10

### 🎉 New features

- Use new expo-updates configuration:syncnative for versioned native sync. ([#2269](https://github.com/expo/eas-cli/pull/2269) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Fix expo-updates package version detection for canaries. ([#2243](https://github.com/expo/eas-cli/pull/2243) by [@wschurman](https://github.com/wschurman))
- Add missing `config` property to `eas.json` schema. ([#2248](https://github.com/expo/eas-cli/pull/2248) by [@sjchmiela](https://github.com/sjchmiela))
- Use expo-updates runtime version CLI to generate runtime versions. ([#2251](https://github.com/expo/eas-cli/pull/2251) by [@wschurman](https://github.com/wschurman))
- Update @expo/apple-utils to handle changes in API. ([73ba19de6662763cc6bff9fac6b7700ffbd0e88a](https://github.com/expo/eas-cli/commit/73ba19de6662763cc6bff9fac6b7700ffbd0e88a) by [@brentvatne](https://github.com/brentvatne))

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2237](https://github.com/expo/eas-cli/pull/2237) by [@expo-bot](https://github.com/expo-bot))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2240](https://github.com/expo/eas-cli/pull/2240) by [@expo-bot](https://github.com/expo-bot))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2253](https://github.com/expo/eas-cli/pull/2253) by [@expo-bot](https://github.com/expo-bot))
- Include src/\*\*/build directories in vscode search and replace. ([#2250](https://github.com/expo/eas-cli/pull/2250) by [@wschurman](https://github.com/wschurman))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2259](https://github.com/expo/eas-cli/pull/2259) by [@expo-bot](https://github.com/expo-bot))

## [7.3.0](https://github.com/expo/eas-cli/releases/tag/v7.3.0) - 2024-02-19

### 🎉 New features

- Fix expo-updates fingerprinting during update. ([#2231](https://github.com/expo/eas-cli/pull/2231) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Don't require expo on fresh react-native project. ([#2235](https://github.com/expo/eas-cli/pull/2235) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2229](https://github.com/expo/eas-cli/pull/2229) by [@expo-bot](https://github.com/expo-bot))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2230](https://github.com/expo/eas-cli/pull/2230) by [@expo-bot](https://github.com/expo-bot))
- Reword update configuration warning. ([#2234](https://github.com/expo/eas-cli/pull/2234) by [@quinlanj](https://github.com/quinlanj))

## [7.2.0](https://github.com/expo/eas-cli/releases/tag/v7.2.0) - 2024-02-11

### 🎉 New features

- Support configuring a Google Service Account Key via eas credentials, for sending Android Notifications via FCM V1. ([#2197](https://github.com/expo/eas-cli/pull/2197) by [@christopherwalter](https://github.com/christopherwalter))

### 🐛 Bug fixes

- Revert expose expo export dev flag as an option in eas update. ([#2214](https://github.com/expo/eas-cli/pull/2214) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2223](https://github.com/expo/eas-cli/pull/2223) by [@expo-bot](https://github.com/expo-bot))

## [7.1.3](https://github.com/expo/eas-cli/releases/tag/v7.1.3) - 2024-02-07

### 🧹 Chores

- Remove duplicated log message when creating ASC API key. ([#2208](https://github.com/expo/eas-cli/pull/2208) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Add simulator flag to metadata. ([#2073](https://github.com/expo/eas-cli/pull/2073) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Upgrade [`eas-build`](https://github.com/expo/eas-build) dependencies. ([#2220](https://github.com/expo/eas-cli/pull/2220) by [@expo-bot](https://github.com/expo-bot))

## [7.1.2](https://github.com/expo/eas-cli/releases/tag/v7.1.2) - 2024-01-30

### 🧹 Chores

- Add better validation for EAS Submit inputs. ([#2202](https://github.com/expo/eas-cli/pull/2202) by [@szdziedzic](https://github.com/szdziedzic))

## [7.1.1](https://github.com/expo/eas-cli/releases/tag/v7.1.1) - 2024-01-26

### 🐛 Bug fixes

- Revert incorrect EAS Submit input validation changes. ([#2200](https://github.com/expo/eas-cli/pull/2200) by [@szdziedzic](https://github.com/szdziedzic))

## [7.1.0](https://github.com/expo/eas-cli/releases/tag/v7.1.0) - 2024-01-26

### 🎉 New features

- Support requireCommit for EAS Update. ([#2196](https://github.com/expo/eas-cli/pull/2196) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Remove support for classic updates release channel in 50+. ([#2189](https://github.com/expo/eas-cli/pull/2189) by [@wschurman](https://github.com/wschurman))
- Validate EAS Submit inputs better. ([#2198](https://github.com/expo/eas-cli/pull/2198) by [@szdziedzic](https://github.com/szdziedzic))

## [7.0.0](https://github.com/expo/eas-cli/releases/tag/v7.0.0) - 2024-01-19

### 🛠 Breaking changes

- Stop generating eas-update-metadata.json on publish. ([#2187](https://github.com/expo/eas-cli/pull/2187) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Use branch mapping utility fn. ([#2186](https://github.com/expo/eas-cli/pull/2186) by [@quinlanj](https://github.com/quinlanj))

## [6.1.0](https://github.com/expo/eas-cli/releases/tag/v6.1.0) - 2024-01-18

### 🎉 New features

- Add `build:delete` command. ([#2178](https://github.com/expo/eas-cli/pull/2178) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Add filter flags for `platform` and `profile` to `build:cancel` and `build:delete` commands. ([#2178](https://github.com/expo/eas-cli/pull/2178) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🧹 Chores

- Remove "bare"-specific **eas.json** template. ([#2179](https://github.com/expo/eas-cli/pull/2179) by [@sjchmiela](https://github.com/sjchmiela))
- Prompt users if they want to continue if EAS CLI fails to provision the devices. ([#2181](https://github.com/expo/eas-cli/pull/2181) by [@szdziedzic](https://github.com/szdziedzic))
- Update `eas-cli` and `@expo/eas-json` dependencies. ([#2176](https://github.com/expo/eas-cli/pull/2176) by [@szdziedzic](https://github.com/szdziedzic))
- Update `eas.schema.json` to after adding Xcode 15.2 image. ([#2184](https://github.com/expo/eas-cli/pull/2184) by [@szdziedzic](https://github.com/szdziedzic))
- Upgrade packages from the expo/expo repo. ([#2145](https://github.com/expo/eas-cli/pull/2145) by [@wschurman](https://github.com/wschurman))

## [6.0.0](https://github.com/expo/eas-cli/releases/tag/v6.0.0) - 2024-01-12

### 🛠 Breaking changes

- Drop support for Node 14. ([#2175](https://github.com/expo/eas-cli/pull/2175) by [@szdziedzic](https://github.com/szdziedzic))

### 🎉 New features

- Allow undefined update message for EAS Update publishing when no VCS. ([#2148](https://github.com/expo/eas-cli/pull/2148) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Upgrade `@expo/eas-build-job` to `1.0.56`, thus removing unused (since [#1524](https://github.com/expo/eas-cli/pull/1524)) support for S3 project archives. ([#2165](https://github.com/expo/eas-cli/pull/2165) by [@sjchmiela](https://github.com/sjchmiela))

## [5.9.3](https://github.com/expo/eas-cli/releases/tag/v5.9.3) - 2023-12-19

### 🧹 Chores

- Rename getUpdateGroupJsonInfo. ([#2157](https://github.com/expo/eas-cli/pull/2157) by [@quinlanj](https://github.com/quinlanj))
- Add new Xcode 15.1 image to `eas.schema.json`. ([#2155](https://github.com/expo/eas-cli/pull/2155) by [@szdziedzic](https://github.com/szdziedzic))

## [5.9.2](https://github.com/expo/eas-cli/releases/tag/v5.9.2) - 2023-12-15

### 🧹 Chores

- Throw error if custom build config is gitignored. ([#2123](https://github.com/expo/eas-cli/pull/2123) by [@szdziedzic](https://github.com/szdziedzic))
- Update `@expo/steps` library to `1.0.51`. ([#2130](https://github.com/expo/eas-cli/pull/2130) by [@szdziedzic](https://github.com/szdziedzic))
- Update `eas.schema.json` to include changes after some of our images were migrated from Ubuntu 18.04 to Ubuntu 20.04. ([#2137](https://github.com/expo/eas-cli/pull/2137) by [@szdziedzic](https://github.com/szdziedzic))
- Update oclif dependencies. ([#2008](https://github.com/expo/eas-cli/pull/2008) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Upgrade `eas-build-job` and unify how we're handling `buildMode`. ([#2138](https://github.com/expo/eas-cli/pull/2138) by [@sjchmiela](https://github.com/sjchmiela))

## [5.9.1](https://github.com/expo/eas-cli/releases/tag/v5.9.1) - 2023-11-20

### 🐛 Bug fixes

- Don't ask a user to install the dev client if running in non-interactive mode. ([#2124](https://github.com/expo/eas-cli/pull/2124) by [@szdziedzic](https://github.com/szdziedzic))
- Always refresh existing provisioning profile before use. ([#2125](https://github.com/expo/eas-cli/pull/2125) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

## [5.9.0](https://github.com/expo/eas-cli/releases/tag/v5.9.0) - 2023-11-15

### 🎉 New features

- Add `--profile` flag to `eas build:run` command. ([#2035](https://github.com/expo/eas-cli/pull/2035) by [@szdziedzic](https://github.com/szdziedzic))

## [5.8.0](https://github.com/expo/eas-cli/releases/tag/v5.8.0) - 2023-11-13

### 🎉 New features

- Move channel:rollout out of developer preview. ([#2114](https://github.com/expo/eas-cli/pull/2114) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Fixed provisioning of new devices into an existing profile. ([#2119](https://github.com/expo/eas-cli/pull/2119) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🧹 Chores

- Update `@expo/package-manager` to `1.1.2` to change package manager resolution order. ([#2118](https://github.com/expo/eas-cli/pull/2118) by [@szdziedzic](https://github.com/szdziedzic))

## [5.7.0](https://github.com/expo/eas-cli/releases/tag/v5.7.0) - 2023-11-08

### 🎉 New features

- Add `EXPO_APPLE_TEAM_ID` and `EXPO_APPLE_PROVIDER_ID` support. ([#2091](https://github.com/expo/eas-cli/pull/2091) by [@EvanBacon](https://github.com/EvanBacon))

### 🧹 Chores

- Add link to SDK upgrade page for SDK-gated command error. ([#2106](https://github.com/expo/eas-cli/pull/2106) by [@wschurman](https://github.com/wschurman))
- Add `selectedImage` and `customNodeVersion` information to build metadata. ([#2113](https://github.com/expo/eas-cli/pull/2113) by [@szdziedzic](https://github.com/szdziedzic))

## [5.6.0](https://github.com/expo/eas-cli/releases/tag/v5.6.0) - 2023-10-27

### 🎉 New features

- Use corresponding submit profile when selecting build from EAS. ([#2101](https://github.com/expo/eas-cli/pull/2101) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🐛 Bug fixes

- Added `buildArtifactsUrl` to `eas-cli build:view --json` output. ([#2102](https://github.com/expo/eas-cli/pull/2102) by [@sjchmiela](https://github.com/sjchmiela))

## [5.5.0](https://github.com/expo/eas-cli/releases/tag/v5.5.0) - 2023-10-25

### 🎉 New features

- Add account type to the items in the prompt to select project owner. ([#2083](https://github.com/expo/eas-cli/pull/2083) by [@alanjhughes](https://github.com/alanjhughes))
- Gate roll back to embedded to expo-updates >= 0.19.0. ([#2094](https://github.com/expo/eas-cli/pull/2094) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- EAS Update: Increase asset upload timeout to 90s and reset on upload retry for slow connections. ([#2085](https://github.com/expo/eas-cli/pull/2085) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Add `requiredPackageManager` to metadata. ([#2067](https://github.com/expo/eas-cli/pull/2067) by [@kadikraman](https://github.com/kadikraman))
- Move `getVcsClient` into command context. ([#2086](https://github.com/expo/eas-cli/pull/2086) by [@Josh-McFarlin](https://github.com/Josh-McFarlin))
- Display Apple device creation date when listing devices. ([#2092](https://github.com/expo/eas-cli/pull/2092) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Clean up Intel resource classes code after their deletion. ([#2093](https://github.com/expo/eas-cli/pull/2093) by [@szdziedzic](https://github.com/szdziedzic))
- Update images descriptions in `eas.schema.json` and add info about the new JDK 17 image. ([#2099](https://github.com/expo/eas-cli/pull/2099) by [@szdziedzic](https://github.com/szdziedzic))

## [5.4.0](https://github.com/expo/eas-cli/releases/tag/v5.4.0) - 2023-09-28

### 🎉 New features

- Add support for the Tap to Pay on iPhone iOS entitlement. ([#2069](https://github.com/expo/eas-cli/pull/2069) by [@fobos531](https://github.com/fobos531))

## [5.3.1](https://github.com/expo/eas-cli/releases/tag/v5.3.1) - 2023-09-28

### 🧹 Chores

- Update EAS Build images description in our VSCode plugin. Add new `macos-ventura-13.6-xcode-15.0` image. ([#2068](https://github.com/expo/eas-cli/pull/2068) by [@szdziedzic](https://github.com/szdziedzic))

## [5.3.0](https://github.com/expo/eas-cli/releases/tag/v5.3.0) - 2023-09-25

### 🎉 New features

- Update: expose expo cli `--dev` flag as an argument. ([#2050](https://github.com/expo/eas-cli/pull/2050) by [@nderscore](https://github.com/nderscore))
- Support `bun` option in eas.json. ([#2055](https://github.com/expo/eas-cli/pull/2055) by [@kadikraman](https://github.com/kadikraman))

### 🐛 Bug fixes

- Support node aliases in .nvmrc. ([#2052](https://github.com/expo/eas-cli/pull/2052) by [@khamilowicz](https://github.com/khamilowicz))

### 🧹 Chores

- Rollouts: more robust printing function. ([#2047](https://github.com/expo/eas-cli/pull/2047) by [@quinlanj](https://github.com/quinlanj))

## [5.2.0](https://github.com/expo/eas-cli/releases/tag/v5.2.0) - 2023-09-05

### 🎉 New features

- Rollouts: json output for ci. ([#2037](https://github.com/expo/eas-cli/pull/2037) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Update: only print channel-branch pairing if we created a channel. ([#2036](https://github.com/expo/eas-cli/pull/2036) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Added rollout tests. ([#2042](https://github.com/expo/eas-cli/pull/2042) by [@quinlanj](https://github.com/quinlanj))
- Remove unreachable codesigning option. ([#2041](https://github.com/expo/eas-cli/pull/2041) by [@quinlanj](https://github.com/quinlanj))
- Fix generated graphql tsc errors. ([#2039](https://github.com/expo/eas-cli/pull/2039) by [@quinlanj](https://github.com/quinlanj))
- Rollouts: view action for CI. ([#2040](https://github.com/expo/eas-cli/pull/2040) by [@quinlanj](https://github.com/quinlanj))

## [5.1.0](https://github.com/expo/eas-cli/releases/tag/v5.1.0) - 2023-09-01

### 🎉 New features

- Support `pnpm` option in eas.json. ([#1988](https://github.com/expo/eas-cli/pull/1988) by [@khamilowicz](https://github.com/khamilowicz))

### 🐛 Bug fixes

- Make app config error not repeat indefinitely. ([#2020](https://github.com/expo/eas-cli/pull/2020) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

## [5.0.2](https://github.com/expo/eas-cli/releases/tag/v5.0.2) - 2023-08-29

### 🐛 Bug fixes

- Add proper expo cli `--platform` flag handling when exporting updates. ([#1939](https://github.com/expo/eas-cli/pull/1939) by [@byCedric](https://github.com/byCedric))

## [5.0.1](https://github.com/expo/eas-cli/releases/tag/v5.0.1) - 2023-08-28

### 🐛 Bug fixes

- Pass `platform` argument to expo-cli correctly when using the `eas update` command. ([#2028](https://github.com/expo/eas-cli/pull/2028) by [@szdziedzic](https://github.com/szdziedzic))

## [5.0.0](https://github.com/expo/eas-cli/releases/tag/v5.0.0) - 2023-08-28

### 🛠 Breaking changes

- Only export at most ios and android dist for EAS updates. ([#2002](https://github.com/expo/eas-cli/pull/2002) by [@wschurman](https://github.com/wschurman))

### 🎉 New features

- Add rollback disambiguation command. ([#2004](https://github.com/expo/eas-cli/pull/2004) by [@wschurman](https://github.com/wschurman))
- Detect devices that fail to be provisioned, list them to the user and show the explanation message with the link to the devices page to check actual status. ([#2011](https://github.com/expo/eas-cli/pull/2011) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Add info to EAS Update asset upload process about asset counts and limits. ([#2013](https://github.com/expo/eas-cli/pull/2013) by [@wschurman](https://github.com/wschurman))
- .nvmrc support for setting node version. ([#1954](https://github.com/expo/eas-cli/pull/1954) by [@khamilowicz](https://github.com/khamilowicz))

### 🐛 Bug fixes

- Support republishing roll back to embedded updates. ([#2006](https://github.com/expo/eas-cli/pull/2006) by [@wschurman](https://github.com/wschurman))
- Configure updates as well when somebody tries to run a build with channel set. ([#2016](https://github.com/expo/eas-cli/pull/2016) by [@wschurman](https://github.com/wschurman))
- Fix printing bug: branch with no update. ([#2023](https://github.com/expo/eas-cli/pull/2023) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- More branch map utility functions. ([#2001](https://github.com/expo/eas-cli/pull/2001) by [@quinlanj](https://github.com/quinlanj))
- More branch mapping utils. ([#2003](https://github.com/expo/eas-cli/pull/2003) by [@quinlanj](https://github.com/quinlanj))
- Create a linked channel on build if not exists. ([#2017](https://github.com/expo/eas-cli/pull/2017) by [@quinlanj](https://github.com/quinlanj))
- Add `developmentClient` to metadata. ([#2015](https://github.com/expo/eas-cli/pull/2015) by [@szdziedzic](https://github.com/szdziedzic))

## [4.1.2](https://github.com/expo/eas-cli/releases/tag/v4.1.2) - 2023-08-10

### 🧹 Chores

- Make branch mapping utility files have no dependencies. ([#1993](https://github.com/expo/eas-cli/pull/1993) by [@quinlanj](https://github.com/quinlanj))

## [4.1.1](https://github.com/expo/eas-cli/releases/tag/v4.1.1) - 2023-08-08

### 🧹 Chores

- Logger to say website support is coming soon for rollouts. ([#1997](https://github.com/expo/eas-cli/pull/1997) by [@quinlanj](https://github.com/quinlanj))

## [4.1.0](https://github.com/expo/eas-cli/releases/tag/v4.1.0) - 2023-08-08

### 🎉 New features

- Pass credentials to custom iOS builds. ([#1989](https://github.com/expo/eas-cli/pull/1989) by [@szdziedzic](https://github.com/szdziedzic))
- Add the `withoutCredentials` option as a common build profile field in `eas.json`. ([#1994](https://github.com/expo/eas-cli/pull/1994) by [@szdziedzic](https://github.com/szdziedzic))

## [4.0.1](https://github.com/expo/eas-cli/releases/tag/v4.0.1) - 2023-08-08

### 🐛 Bug fixes

- Fix `eas channel:*` to work with empty branch mappings. ([#1992](https://github.com/expo/eas-cli/pull/1992) by [@quinlanj](https://github.com/quinlanj))

## [4.0.0](https://github.com/expo/eas-cli/releases/tag/v4.0.0) - 2023-08-07

### 🛠 Breaking changes

- Release redesigned `eas channel:rollout` into developer preview. The set of flag arguments are different, in addition to the workflow. ([#1986](https://github.com/expo/eas-cli/pull/1986) by [@quinlanj](https://github.com/quinlanj))

### 🎉 New features

- Option to add current Apple Silicon device without the need to manually provide the provisioning UDID. ([#1943](https://github.com/expo/eas-cli/pull/1943) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🐛 Bug fixes

- Fix rollout-preview ending with republish with code signing. ([#1978](https://github.com/expo/eas-cli/pull/1978) by [@wschurman](https://github.com/wschurman))
- Rollouts: fix fp precision. ([#1985](https://github.com/expo/eas-cli/pull/1985) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Fixing more grammar errors. ([#1980](https://github.com/expo/eas-cli/pull/1980) by [@quinlanj](https://github.com/quinlanj))
- Handle rollout edit edge case. ([#1981](https://github.com/expo/eas-cli/pull/1981) by [@quinlanj](https://github.com/quinlanj))
- Linked expo.fyi rollout article. ([#1991](https://github.com/expo/eas-cli/pull/1991) by [@quinlanj](https://github.com/quinlanj))
- Rollout ux improvements. ([#1984](https://github.com/expo/eas-cli/pull/1984) by [@quinlanj](https://github.com/quinlanj))

## [3.18.3](https://github.com/expo/eas-cli/releases/tag/v3.18.3) - 2023-08-03

### 🐛 Bug fixes

- Fix republishing with code signing. ([#1973](https://github.com/expo/eas-cli/pull/1973) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Add relationships flag to rollouts-preview. ([#1972](https://github.com/expo/eas-cli/pull/1972) by [@quinlanj](https://github.com/quinlanj))
- Get channel:{view,list,edit} to play nice with rollouts. ([#1974](https://github.com/expo/eas-cli/pull/1974) by [@quinlanj](https://github.com/quinlanj))
- Use 'roll out' instead of rollout for verbs. ([#1979](https://github.com/expo/eas-cli/pull/1979) by [@quinlanj](https://github.com/quinlanj))

## [3.18.2](https://github.com/expo/eas-cli/releases/tag/v3.18.2) - 2023-08-03

### 🐛 Bug fixes

- Revert adding `.nvmrc` support for setting node version. ([#1976](https://github.com/expo/eas-cli/pull/1976) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Use just a comma instead of `, ` when concatenating `keywords` in `eas metadata`. ([#1967](https://github.com/expo/eas-cli/pull/1967) by [@szdziedzic](https://github.com/szdziedzic))

## [3.18.1](https://github.com/expo/eas-cli/releases/tag/v3.18.1) - 2023-08-03

### 🐛 Bug fixes

- Pass correct group into `update:republish`. ([#1971](https://github.com/expo/eas-cli/pull/1971) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Make new rollouts version available for internal dogfooding. ([#1966](https://github.com/expo/eas-cli/pull/1966) by [@quinlanj](https://github.com/quinlanj))
- Change default runtime version policy for EAS Update to appVersion. ([#1968](https://github.com/expo/eas-cli/pull/1968) by [@quinlanj](https://github.com/quinlanj))

## [3.18.0](https://github.com/expo/eas-cli/releases/tag/v3.18.0) - 2023-08-02

### 🎉 New features

- .nvmrc support for setting node version. ([#1954](https://github.com/expo/eas-cli/pull/1954) by [@khamilowicz](https://github.com/khamilowicz))
- Provide credentials for custom Android builds. ([#1969](https://github.com/expo/eas-cli/pull/1969) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- More branch mapping utility. ([#1957](https://github.com/expo/eas-cli/pull/1957) by [@quinlanj](https://github.com/quinlanj))
- Utility classes to select existing rollouts and channels. ([#1958](https://github.com/expo/eas-cli/pull/1958) by [@quinlanj](https://github.com/quinlanj))

## [3.17.1](https://github.com/expo/eas-cli/releases/tag/v3.17.1) - 2023-07-27

### 🧹 Chores

- Unify channel graphql query types. ([#1949](https://github.com/expo/eas-cli/pull/1949) by [@quinlanj](https://github.com/quinlanj))
- Revert UpdateBranchWithCurrentGroupFragment. ([#1952](https://github.com/expo/eas-cli/pull/1952) by [@quinlanj](https://github.com/quinlanj))
- Fetch entire relay compliant dataset. ([#1953](https://github.com/expo/eas-cli/pull/1953) by [@quinlanj](https://github.com/quinlanj))

## [3.17.0](https://github.com/expo/eas-cli/releases/tag/v3.17.0) - 2023-07-24

### 🎉 New features

- Add `rollout` option for configuring Android submissions. ([#1938](https://github.com/expo/eas-cli/pull/1938) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Added branch mapping utility functions. ([#1944](https://github.com/expo/eas-cli/pull/1944) by [@quinlanj](https://github.com/quinlanj))
- Amend branch mapping utility functions. ([#1945](https://github.com/expo/eas-cli/pull/1945) by [@quinlanj](https://github.com/quinlanj))
- Handle error thrown when `intel-medium` resource class is not available as server-side defined error. ([#1947](https://github.com/expo/eas-cli/pull/1947) by [@szdziedzic](https://github.com/szdziedzic))
- Remove `intel-medium` from `eas.schema.json`, so it's not suggested as a valid value by our VSCode plugin. ([#1947](https://github.com/expo/eas-cli/pull/1947) by [@szdziedzic](https://github.com/szdziedzic))

## [3.16.0](https://github.com/expo/eas-cli/releases/tag/v3.16.0) - 2023-07-18

### 🎉 New features

- Add styling to SSO auth redirect completion page. ([#1929](https://github.com/expo/eas-cli/pull/1929) by [@wschurman](https://github.com/wschurman))
- Ignore entitlements from native template when `/ios` is gitignored. ([#1906](https://github.com/expo/eas-cli/pull/1906) by [@byCedric](https://github.com/byCedric))
- Use node server default port selection for SSO login server. ([#1930](https://github.com/expo/eas-cli/pull/1930) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Fix incorrect handling of valid `inProgress` Android submission release status. ([#1934](https://github.com/expo/eas-cli/pull/1934) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Print friendly error msg in case account doesn't have required permission. ([#1867](https://github.com/expo/eas-cli/pull/1867) by [@firasrg](https://github.com/firasrg))
- Limit project file upload size to 2GB. ([#1928](https://github.com/expo/eas-cli/pull/1928) by [@khamilowicz](https://github.com/khamilowicz))
- Bump urql graphql client major version. ([#1936](https://github.com/expo/eas-cli/pull/1936) by [@quinlanj](https://github.com/quinlanj))

## [3.15.1](https://github.com/expo/eas-cli/releases/tag/v3.15.1) - 2023-07-11

### 🐛 Bug fixes

- Ensure useClassicUpdates is not set when using EAS Update commands. ([#1915](https://github.com/expo/eas-cli/pull/1915) by [@ide](https://github.com/ide))
- Handle multiple GraphQLErrors when receiving a CombinedError. ([#1924](https://github.com/expo/eas-cli/pull/1924) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

### 🧹 Chores

- Bump Expo package dependencies. ([#1911](https://github.com/expo/eas-cli/pull/1911) by [@brentvatne](https://github.com/brentvatne))
- Better bare workflow runtimeVersion error. ([#1910](https://github.com/expo/eas-cli/pull/1910) by [@quinlanj](https://github.com/quinlanj))
- Fix runtime version print logs. ([#1925](https://github.com/expo/eas-cli/pull/1925) by [@quinlanj](https://github.com/quinlanj))
- Add info about new `macos-ventura-13.4-xcode-14.3.1` image to `eas.schema.json`. ([#1920](https://github.com/expo/eas-cli/pull/1920) by [@szdziedzic](https://github.com/szdziedzic))

## [3.15.0](https://github.com/expo/eas-cli/releases/tag/v3.15.0) - 2023-06-30

### 🎉 New features

- Show build profile when selecting a build for eas build:run. ([#1901](https://github.com/expo/eas-cli/pull/1901) by [@keith-kurak](https://github.com/keith-kurak))
- Adds -m alias to --message in update/republish and removed README comment. ([#1905](https://github.com/expo/eas-cli/pull/1905) by [@pusongqi](https://github.com/pusongqi))

### 🧹 Chores

- Better runtimeVersion output. ([#1894](https://github.com/expo/eas-cli/pull/1894) by [@quinlanj](https://github.com/quinlanj))
- Print better error message when uploading project archive tarball fails. ([#1897](https://github.com/expo/eas-cli/pull/1897) by [@szdziedzic](https://github.com/szdziedzic))
- Adds support for 2 new server-side errors related to build limits. ([#1921](https://github.com/expo/eas-cli/pull/1921) by [@sundeeppeswani](https://github.com/sundeeppeswani))

## [3.14.0](https://github.com/expo/eas-cli/releases/tag/v3.14.0) - 2023-06-20

### 🎉 New features

- Added support for SSO users. ([#1875](https://github.com/expo/eas-cli/pull/1875) by [@lzkb](https://github.com/lzkb))
- Added new bundle identifier capabilities and entitlements from WWDC23. ([#1870](https://github.com/expo/eas-cli/pull/1870) by [@EvanBacon](https://github.com/EvanBacon))
- Selecting default keystore via CLI. ([#1889](https://github.com/expo/eas-cli/pull/1889) by [@khamilowicz](https://github.com/khamilowicz))

### 🧹 Chores

- Change sso flag display. ([#1890](https://github.com/expo/eas-cli/pull/1890) by [@lzkb](https://github.com/lzkb))
- Build:configure -- add channels to eas.json if using eas updates. ([#1887](https://github.com/expo/eas-cli/pull/1887) by [@quinlanj](https://github.com/quinlanj))
- Eas update: Error gracefully if no git repo. ([#1884](https://github.com/expo/eas-cli/pull/1884) by [@quinlanj](https://github.com/quinlanj))
- Error gracefully if expo pkg not installed. ([#1883](https://github.com/expo/eas-cli/pull/1883) by [@quinlanj](https://github.com/quinlanj))
- Update `eas build:configure` command to show the link of `eas.json` when generated. ([#1878](https://github.com/expo/eas-cli/pull/1878) by [@amandeepmittal](https://github.com/amandeepmittal))
- Create app.json or add the "expo" key if either are missing, before modifying or reading the file. ([#1881](https://github.com/expo/eas-cli/pull/1881) by [@brentvatne](https://github.com/brentvatne))
- Include the original stack in re-thrown errors thrown from EAS CLI commands. ([#1882](https://github.com/expo/eas-cli/pull/1882) by [@brentvatne](https://github.com/brentvatne))
- Make `update:configure` less verbose. ([#1888](https://github.com/expo/eas-cli/pull/1888) by [@quinlanj](https://github.com/quinlanj))
- Improve validation for values from app config. ([#1893](https://github.com/expo/eas-cli/pull/1893) by [@wkozyra95](https://github.com/wkozyra95))
- Improve `expo-updates` validation for builds with `channel` property set. ([#1885](https://github.com/expo/eas-cli/pull/1885) by [@szdziedzic](https://github.com/szdziedzic))

## [3.13.3](https://github.com/expo/eas-cli/releases/tag/v3.13.3) - 2023-06-05

### 🐛 Bug fixes

- Show original GraphQL error message in case of an unexpected error. ([#1862](https://github.com/expo/eas-cli/pull/1862) by [@dsokal](https://github.com/dsokal))
- Fix updates synchronization of native files to include strings.xml for bare projects. ([#1865](https://github.com/expo/eas-cli/pull/1865) by [@wschurman](https://github.com/wschurman))

## [3.13.2](https://github.com/expo/eas-cli/releases/tag/v3.13.2) - 2023-05-26

### 🧹 Chores

- Refactor getExpoConfig to remove dangerous default. ([#1857](https://github.com/expo/eas-cli/pull/1857) by [@wschurman](https://github.com/wschurman))
- Add support for pending-cancel build status. ([#1855](https://github.com/expo/eas-cli/pull/1855) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

## [3.13.1](https://github.com/expo/eas-cli/releases/tag/v3.13.1) - 2023-05-24

### 🧹 Chores

- Short format for selecting devices prompt. ([#1840](https://github.com/expo/eas-cli/pull/1840) by [@khamilowicz](https://github.com/khamilowicz))
- Improve typescript types for user display. ([#1851](https://github.com/expo/eas-cli/pull/1851) by [@wschurman](https://github.com/wschurman))
- Add error for `large` resource class not available on the free plan to server-side defined errors. ([#1848](https://github.com/expo/eas-cli/pull/1848) by [@szdziedzic](https://github.com/szdziedzic))

## [3.13.0](https://github.com/expo/eas-cli/releases/tag/v3.13.0) - 2023-05-17

### 🎉 New features

- Add clear cache flag to eas update. ([#1839](https://github.com/expo/eas-cli/pull/1839) by [@quinlanj](https://github.com/quinlanj))
- Print EAS Update assets that timed out during upload or processing. ([#1849](https://github.com/expo/eas-cli/pull/1849) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Fix building iOS projects with framework targets. ([#1835](https://github.com/expo/eas-cli/pull/1835) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Ignore dirty workingdir when building from GitHub. ([#1842](https://github.com/expo/eas-cli/pull/1842) by [@wkozyra95](https://github.com/wkozyra95))
- Remove App Specific Password prompt. ([#1843](https://github.com/expo/eas-cli/pull/1843) by [@quinlanj](https://github.com/quinlanj))
- Validate `CFBundleShortVersionString`. ([#1846](https://github.com/expo/eas-cli/pull/1846) by [@khamilowicz](https://github.com/khamilowicz))

## [3.12.1](https://github.com/expo/eas-cli/releases/tag/v3.12.1) - 2023-05-15

### 🐛 Bug fixes

- Don't submit expired builds. ([#1837](https://github.com/expo/eas-cli/pull/1837) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Change red apple icon to green apple icon on successful build. ([#1828](https://github.com/expo/eas-cli/pull/1828) by [@dchhetri](https://github.com/dchhetri))

## [3.12.0](https://github.com/expo/eas-cli/releases/tag/v3.12.0) - 2023-05-08

### 🎉 New features

- Add `build:version:get` command. ([#1815](https://github.com/expo/eas-cli/pull/1815) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Upgrade dependencies. ([#1824](https://github.com/expo/eas-cli/pull/1824) by [@dsokal](https://github.com/dsokal))

## [3.11.0](https://github.com/expo/eas-cli/releases/tag/v3.11.0) - 2023-05-05

### 🎉 New features

- Add account list to `eas whoami`/`eas account:view`. ([#1814](https://github.com/expo/eas-cli/pull/1814) by [@wschurman](https://github.com/wschurman))
- Add `large` resource class for iOS as allowed value in `eas.json`. ([#1817](https://github.com/expo/eas-cli/pull/1817) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Print request ID on unforeseen GraphQL error for easier tracking and follow up. ([#1813](https://github.com/expo/eas-cli/pull/1813) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

## [3.10.2](https://github.com/expo/eas-cli/releases/tag/v3.10.2) - 2023-04-25

### 🧹 Chores

- Add info about Xcode 14.3 image to `eas.schema.json`. ([#1808](https://github.com/expo/eas-cli/pull/1808) by [@szdziedzic](https://github.com/szdziedzic))
- Allow users to select an app to run using the `build:run` command if multiple apps are found in the tarball. ([#1807](https://github.com/expo/eas-cli/pull/1807) by [@szdziedzic](https://github.com/szdziedzic))
- Don't resolve `default` resource class for iOS in CLI. ([#1734](https://github.com/expo/eas-cli/pull/1734) by [@szdziedzic](https://github.com/szdziedzic))

## [3.10.1](https://github.com/expo/eas-cli/releases/tag/v3.10.1) - 2023-04-25

### 🧹 Chores

- Add `cache.paths` field and deprecate `cache.customPaths`. ([#1794](https://github.com/expo/eas-cli/pull/1794) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

## [3.10.0](https://github.com/expo/eas-cli/releases/tag/v3.10.0) - 2023-04-21

### 🎉 New features

- Added eas device:rename command. ([#1787](https://github.com/expo/eas-cli/pull/1787) by [@keith-kurak](https://github.com/keith-kurak))

### 🐛 Bug fixes

- Fix `device:delete` not disabling on Apple. ([#1803](https://github.com/expo/eas-cli/pull/1803) by [@keith-kurak](https://github.com/keith-kurak))
- Fix message truncation for updates. ([#1801](https://github.com/expo/eas-cli/pull/1801) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Throw an error if somebody tries to start iOS build with the `large` resource class selected using the deprecated `--resource-class` flag. ([#1795](https://github.com/expo/eas-cli/pull/1795) by [@szdziedzic](https://github.com/szdziedzic))

## [3.9.3](https://github.com/expo/eas-cli/releases/tag/v3.9.3) - 2023-04-18

### 🐛 Bug fixes

- Fix prompts in `eas update`. ([#1797](https://github.com/expo/eas-cli/pull/1797) by [@wschurman](https://github.com/wschurman))

## [3.9.2](https://github.com/expo/eas-cli/releases/tag/v3.9.2) - 2023-04-13

### 🐛 Bug fixes

- Fixes the rollout percentages when ending a rollout. ([#1781](https://github.com/expo/eas-cli/pull/1781) by [@jonsamp](https://github.com/jonsamp))
- Print meaningful error message if `extra.eas.projectId` is not a string. ([#1788](https://github.com/expo/eas-cli/pull/1788) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Show output of `expo install expo-updates`. ([#1782](https://github.com/expo/eas-cli/pull/1782) by [@wkozyra95](https://github.com/wkozyra95))
- Print deprecation warnings for deprecated `eas.json` fields. ([#1768](https://github.com/expo/eas-cli/pull/1768) by [@szdziedzic](https://github.com/szdziedzic))

## [3.9.1](https://github.com/expo/eas-cli/releases/tag/v3.9.1) - 2023-04-10

### 🐛 Bug fixes

- Update apple utilities to work around the maintenance error. ([#1780](https://github.com/expo/eas-cli/pull/1780) by [@byCedric](https://github.com/byCedric))

### 🧹 Chores

- Don't use defaults for the `cache.cacheDefaultPaths` build profile field. ([#1769](https://github.com/expo/eas-cli/pull/1769) by [@szdziedzic](https://github.com/szdziedzic))

## [3.9.0](https://github.com/expo/eas-cli/releases/tag/v3.9.0) - 2023-04-06

### 🎉 New features

- Add support for roll back to embedded updates. ([#1754](https://github.com/expo/eas-cli/pull/1754), [#1755](https://github.com/expo/eas-cli/pull/1755) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Update `expoCommandAsync` to support the new Expo CLI bin path. ([#1772](https://github.com/expo/eas-cli/pull/1772) by [@gabrieldonadel](https://github.com/gabrieldonadel))

### 🧹 Chores

- Use the `eas-cli` npm tag for checking for the local build plugin updates. ([#1759](https://github.com/expo/eas-cli/pull/1759) by [@dsokal](https://github.com/dsokal))
- Ignore `requireCommit` option in `eas build:internal`. ([#1760](https://github.com/expo/eas-cli/pull/1760) by [@wkozyra95](https://github.com/wkozyra95))
- Support parsing eas.json from a string. ([#1766](https://github.com/expo/eas-cli/pull/1766) by [@wkozyra95](https://github.com/wkozyra95))

## [3.8.1](https://github.com/expo/eas-cli/releases/tag/v3.8.1) - 2023-03-16

### 🐛 Bug fixes

- Ensure public config is used as update. ([#1745](https://github.com/expo/eas-cli/pull/1745) by [@byCedric](https://github.com/byCedric))

### 🧹 Chores

- Unify how the command errors are displayed. ([#1738](https://github.com/expo/eas-cli/pull/1738) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))
- Unify the case of base error messages for command failures. ([#1744](https://github.com/expo/eas-cli/pull/1744) by [@radoslawkrzemien](https://github.com/radoslawkrzemien))

## [3.8.0](https://github.com/expo/eas-cli/releases/tag/v3.8.0) - 2023-03-13

### 🎉 New features

- Add new `m-medium` and `m-large` resource classes. ([#1739](https://github.com/expo/eas-cli/pull/1739) by [@szdziedzic](https://github.com/szdziedzic))

## [3.7.2](https://github.com/expo/eas-cli/releases/tag/v3.7.2) - 2023-02-24

### 🐛 Bug fixes

- Implement Apple's proprietary Hashcash algorithm for signing authentication requests. ([#1719](https://github.com/expo/eas-cli/pull/1719) by [@EvanBacon](https://github.com/EvanBacon))

## [3.7.1](https://github.com/expo/eas-cli/releases/tag/v3.7.1) - 2023-02-23

### 🐛 Bug fixes

- Bump `@expo/apple-utils` to fix Apple developer auth. ([03c76c1](https://github.com/expo/eas-cli/commit/03c76c1e0efb9ec55e40b45e33c80b3479f920c3) by [@brentvatne](https://github.com/brentvatne))

## [3.7.0](https://github.com/expo/eas-cli/releases/tag/v3.7.0) - 2023-02-23

### 🎉 New features

- Support variant detection for package\*UniversalApk Gradle Commands. ([#1708](https://github.com/expo/eas-cli/pull/1708) by [@frw](https://github.com/frw))

## [3.6.1](https://github.com/expo/eas-cli/releases/tag/v3.6.1) - 2023-02-20

### 🐛 Bug fixes

- Disable analytics when running behind a proxy. ([#1696](https://github.com/expo/eas-cli/pull/1696) by [@wkozyra95](https://github.com/wkozyra95))
- Clarify missing owner field error message for Robot users. ([#1702](https://github.com/expo/eas-cli/pull/1702) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Validate the platform for local builds earlier. ([#1698](https://github.com/expo/eas-cli/pull/1698) by [@wkozyra95](https://github.com/wkozyra95))
- Display build message when picking build in `eas submit`, `eas build:resign`, and `eas build:run` commands. ([#1700](https://github.com/expo/eas-cli/pull/1700) by [@szdziedzic](https://github.com/szdziedzic))
- Add a link directly to a build phase logs in the EAS CLI build error message. ([#1699](https://github.com/expo/eas-cli/pull/1699) by [@szdziedzic](https://github.com/szdziedzic))

## [3.6.0](https://github.com/expo/eas-cli/releases/tag/v3.6.0) - 2023-02-14

### 🎉 New features

- Use `sdkVersion` as default runtime version policy when running `eas update:configure`. ([#1669](https://github.com/expo/eas-cli/pull/1669) by [@jonsamp](https://github.com/jonsamp))
- Warn when project ID but no owner specified and mismatch logged in user. ([#1667](https://github.com/expo/eas-cli/pull/1667) by [@wschurman](https://github.com/wschurman))
- Return the build `message` if one is available. ([#1691](https://github.com/expo/eas-cli/pull/1691) by [@raulriera](https://github.com/raulriera))

### 🐛 Bug fixes

- Fix suggested application identifier to match owning account name. ([#1670](https://github.com/expo/eas-cli/pull/1670) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Add Xcode 14.2 image to the VSCode schema. ([#1693](https://github.com/expo/eas-cli/pull/1693) by [@szdziedzic](https://github.com/szdziedzic))

## [3.5.2](https://github.com/expo/eas-cli/releases/tag/v3.5.2) - 2023-02-05

### 🐛 Bug fixes

- Use the new developer-mdn.apple.com subdomain instead of developer.apple.com. ([#1673](https://github.com/expo/eas-cli/pull/1673) by [@brentvatne](https://github.com/brentvatne))

## [3.5.1](https://github.com/expo/eas-cli/releases/tag/v3.5.1) - 2023-02-01

### 🐛 Bug fixes

- Fix the issue with the `eas.json` envs being not available when resolving dynamic config. ([#1666](https://github.com/expo/eas-cli/pull/1666) by [@szdziedzic](https://github.com/szdziedzic))

## [3.5.0](https://github.com/expo/eas-cli/releases/tag/v3.5.0) - 2023-01-31

### 🎉 New features

- Set `m1-medium` resource class for SDK version `>=48` and RN version `>=0.71` builds with unspecified resource class. ([#1655](https://github.com/expo/eas-cli/pull/1655) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Fix undefined branchMappingLogic. ([#1653](https://github.com/expo/eas-cli/pull/1653) by [@quinlanj](https://github.com/quinlanj))
- Fix using local credentials for internal distribution builds with universal provisioning. ([#1657](https://github.com/expo/eas-cli/pull/1657) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Move image validation to the server side and better handle server validation errors in the eas-cli. ([#1650](https://github.com/expo/eas-cli/pull/1650) by [@szdziedzic](https://github.com/szdziedzic))
- Update metadata on the worker when using git-based builds. ([#1651](https://github.com/expo/eas-cli/pull/1651) by [@wkozyra95](https://github.com/wkozyra95))

## [3.4.1](https://github.com/expo/eas-cli/releases/tag/v3.4.1) - 2023-01-23

### 🐛 Bug fixes

- Fix incorrect exit code for successful local builds. ([#1649](https://github.com/expo/eas-cli/pull/1649) by [@dsokal](https://github.com/dsokal))

## [3.4.0](https://github.com/expo/eas-cli/releases/tag/v3.4.0) - 2023-01-20

### 🎉 New features

- Add `--json` flag to `eas config` command. ([#1568](https://github.com/expo/eas-cli/pull/1568) by [@wkozyra95](https://github.com/wkozyra95))
- Add M1 resource class configuration to default eas.json when running eas build:configure on a new project. ([#1637](https://github.com/expo/eas-cli/pull/1637) by [@brentvatne](https://github.com/brentvatne))
- Add prompt to switch iOS builds to M1 if the build queue is long. ([#1642](https://github.com/expo/eas-cli/pull/1642) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix running commands with `--json` flag when EAS_NO_VCS is set. ([#1641](https://github.com/expo/eas-cli/pull/1641) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Remove unnecessary workaround for trailing backslash in .gitignore. ([#1622](https://github.com/expo/eas-cli/pull/1622) by [@wkozyra95](https://github.com/wkozyra95))
- Internal command that will be run on EAS worker when building from GitHub. ([#1568](https://github.com/expo/eas-cli/pull/1568) by [@wkozyra95](https://github.com/wkozyra95))
- Make the disabled tier error message more descriptive. ([#1635](https://github.com/expo/eas-cli/pull/1635) by [@dsokal](https://github.com/dsokal))
- Control some of the EAS Build error messages server-side. ([#1639](https://github.com/expo/eas-cli/pull/1639) by [@wkozyra95](https://github.com/wkozyra95))

## [3.3.2](https://github.com/expo/eas-cli/releases/tag/v3.3.2) - 2023-01-12

### 🐛 Bug fixes

- Add missing key information about updates in `eas update --json` and `eas update:view --json`. ([#1619](https://github.com/expo/eas-cli/pull/1619) by [@byCedric](https://github.com/byCedric))

### 🧹 Chores

- Upgrade dependencies. ([#1617](https://github.com/expo/eas-cli/pull/1617) by [@dsokal](https://github.com/dsokal))
- Improve handling `SSOUser` type. ([#1621](https://github.com/expo/eas-cli/pull/1621) by [@szdziedzic](https://github.com/szdziedzic))

## [3.3.1](https://github.com/expo/eas-cli/releases/tag/v3.3.1) - 2023-01-11

### 🐛 Bug fixes

- Revert missing key information about updates in `eas update --json` and `eas update:view --json`. ([d20db0f](https://github.com/expo/eas-cli/commit/d20db0fff42a6f4512fea426a66cb6f168e37f7c) by [@ide](https://github.com/ide))

## [3.3.0](https://github.com/expo/eas-cli/releases/tag/v3.3.0) - 2023-01-11

### 🎉 New features

- Add ability to select resource class for a build in build profile. ([#1609](https://github.com/expo/eas-cli/pull/1609) by [@dsokal](https://github.com/dsokal))
- Deprecate `--resource-class` flag. ([#1615](https://github.com/expo/eas-cli/pull/1615) by [@dsokal](https://github.com/dsokal))
- Add new resource classes and update already available. ([#1616](https://github.com/expo/eas-cli/pull/1616) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Add missing key information about updates in `eas update --json` and `eas update:view --json`. ([#1611](https://github.com/expo/eas-cli/pull/1611) by [@byCedric](https://github.com/byCedric))

## [3.2.1](https://github.com/expo/eas-cli/releases/tag/v3.2.1) - 2023-01-09

### 🐛 Bug fixes

- Validate chosen build in the `eas build:run` command. ([#1614](https://github.com/expo/eas-cli/pull/1614) by [@szdziedzic](https://github.com/szdziedzic))

## [3.2.0](https://github.com/expo/eas-cli/releases/tag/v3.2.0) - 2023-01-09

### 🎉 New features

- Add `--channel` option to `update:republish`. ([#1580](https://github.com/expo/eas-cli/pull/1580) by [@byCedric](https://github.com/byCedric))
- Use `appVersion` as default runtime version policy when running `eas update:configure`. ([#1588](https://github.com/expo/eas-cli/pull/1588) by [@jonsamp](https://github.com/jonsamp))
- Support `--json` flag in webhook list command. ([#1605](https://github.com/expo/eas-cli/pull/1605) by [@sheddy7](https://github.com/sheddy7))

### 🐛 Bug fixes

- Makes eas.json configuration to only run on `update:configure`. ([#1598](https://github.com/expo/eas-cli/pull/1598) by [@jonsamp](https://github.com/jonsamp))
- Fix issue with invisible build info in some terminals in the `eas build:run` and `eas build:resign` commands. ([#1602](https://github.com/expo/eas-cli/pull/1602) by [@szdziedzic](https://github.com/szdziedzic))
- Fix issues with invisible build info in some terminals while using the `eas submit` command. ([#1603](https://github.com/expo/eas-cli/pull/1603) by [@szdziedzic](https://github.com/szdziedzic))
- Use the `completedAt` timestamp as the build finish date instead of the `updatedAt` timestamp in the `eas build:run` command. ([#1604](https://github.com/expo/eas-cli/pull/1604) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Make all URLs in logs clickable in terminals supporting hyperlinks. ([#1591](https://github.com/expo/eas-cli/pull/1591) by [@Simek](https://github.com/Simek))
- Use paginated select prompt for the `eas build:run` command. ([#1601](https://github.com/expo/eas-cli/pull/1601) by [@szdziedzic](https://github.com/szdziedzic))

## [3.1.1](https://github.com/expo/eas-cli/releases/tag/v3.1.1) - 2022-12-19

### 🐛 Bug fixes

- Fix update `--channel` and `--branch` flag validation. ([#1579](https://github.com/expo/eas-cli/pull/1579) by [@byCedric](https://github.com/byCedric))

## [3.1.0](https://github.com/expo/eas-cli/releases/tag/v3.1.0) - 2022-12-17

### 🎉 New features

- Adds `--channel` flag to `eas update`. ([#1567](https://github.com/expo/eas-cli/pull/1567) by [@jonsamp](https://github.com/jonsamp))
- Add channel configurations to **eas.json** during `eas update:configure`. ([#1570](https://github.com/expo/eas-cli/pull/1570) by [@jonsamp](https://github.com/jonsamp))
- Add `build:resign` command. ([#1575](https://github.com/expo/eas-cli/pull/1575) by [@wkozyra95](https://github.com/wkozyra95))

## [3.0.0](https://github.com/expo/eas-cli/releases/tag/v3.0.0) - 2022-12-07

### 🛠 Breaking changes

- Move update republish to separate command. ([#1533](https://github.com/expo/eas-cli/pull/1533) by [@byCedric](https://github.com/byCedric))

### 🐛 Bug fixes

- Make the not recognized image error handler run only if the image is present under a valid key and has an invalid value. ([#1565](https://github.com/expo/eas-cli/pull/1565) by [@szdziedzic](https://github.com/szdziedzic))
- Fix the `node:assert` import error by using imports from `assert` instead of from `node:assert`. ([#1569](https://github.com/expo/eas-cli/pull/1569) by [@szdziedzic](https://github.com/szdziedzic))

### 🧹 Chores

- Remove old republish code from the update command. ([#1535](https://github.com/expo/eas-cli/pull/1535) by [@byCedric](https://github.com/byCedric))

## [2.9.0](https://github.com/expo/eas-cli/releases/tag/v2.9.0) - 2022-12-05

### 🎉 New features

- Add caching for `eas build:run` command. ([#1542](https://github.com/expo/eas-cli/pull/1542) by [@szdziedzic](https://github.com/szdziedzic))
- Add `isGitWorkingTreeDirty` to EAS Update records. ([#1550](https://github.com/expo/eas-cli/pull/1550) by [@FiberJW](https://github.com/FiberJW))
- Prompt developer to download the app after the simulator build is finished. ([#1554](https://github.com/expo/eas-cli/pull/1554) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Ask for the missing application identifier consistently in `eas build:version:sync` command. ([#1543](https://github.com/expo/eas-cli/pull/1543) by [@wkozyra95](https://github.com/wkozyra95))
- Disable selecting builds whose artifacts have expired in the `eas build:run` command. ([#1547](https://github.com/expo/eas-cli/pull/1547) by [@szdziedzic](https://github.com/szdziedzic))
- Change intent with which the `eas build:run` command opens an Android app to `android.intent.action.MAIN`. ([#1556](https://github.com/expo/eas-cli/pull/1556) by [@szdziedzic](https://github.com/szdziedzic))

## [2.8.0](https://github.com/expo/eas-cli/releases/tag/v2.8.0) - 2022-11-28

### 🎉 New features

- Add `eas build:run` support for Android. ([#1485](https://github.com/expo/eas-cli/pull/1485) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Only create a new channel when update branch is new. ([#1507](https://github.com/expo/eas-cli/pull/1507) by [@byCedric](https://github.com/byCedric))

### 🧹 Chores

- Better wording in eas submit. ([#1527](https://github.com/expo/eas-cli/pull/1527) by [@dsokal](https://github.com/dsokal))
- Upload project sources for EAS Build and archives for EAS Submit to GCS. ([#1524](https://github.com/expo/eas-cli/pull/1524) by [@wkozyra95](https://github.com/wkozyra95))
- Add a better error message for when an invalid `image` is set in `eas-json`. ([#1531](https://github.com/expo/eas-cli/pull/1531) by [@szdziedzic](https://github.com/szdziedzic))
- Remove internal expo id from device formatter. ([#1541](https://github.com/expo/eas-cli/pull/1541) by [@dsokal](https://github.com/dsokal))

## [2.7.1](https://github.com/expo/eas-cli/releases/tag/v2.7.1) - 2022-11-16

### 🐛 Bug fixes

- Use envs from the build profile to resolve credentials in `eas credentials`. ([#1520](https://github.com/expo/eas-cli/pull/1520) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Print prompt message when failing because of the non-interactive shell. ([#1523](https://github.com/expo/eas-cli/pull/1523) by [@wkozyra95](https://github.com/wkozyra95))
- Add SDK version to the analytics build events. ([#1529](https://github.com/expo/eas-cli/pull/1529) by [@wkozyra95](https://github.com/wkozyra95))
- Add Xcode 14.1 image to `eas-json`. ([#1511](https://github.com/expo/eas-cli/pull/1511) by [@szdziedzic](https://github.com/szdziedzic))

## [2.7.0](https://github.com/expo/eas-cli/releases/tag/v2.7.0) - 2022-11-11

### 🎉 New features

- Support uploading different platform combinations in `eas update`. ([#1461](https://github.com/expo/eas-cli/pull/1461) by [@EvanBacon](https://github.com/EvanBacon))
- Add Git commit to EAS Update record. ([#1499](https://github.com/expo/eas-cli/pull/1499) by [@fiberjw](https://github.com/fiberjw))
- Use local CLI for `expo export` in SDK +46. ([#1474](https://github.com/expo/eas-cli/pull/1474) by [@EvanBacon](https://github.com/EvanBacon))
- Validate icon PNGs before running Android build. ([#1477](https://github.com/expo/eas-cli/pull/1477) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fixed the values of the distribution enum on the build profile schema receiving the incorrect descriptions. ([#1504](https://github.com/expo/eas-cli/pull/1504) by [@macksal](https://github.com/macksal))
- Remove hard dependency on expo package being installed to init a project. ([#1517](https://github.com/expo/eas-cli/pull/1517) by [@brentvatne](https://github.com/brentvatne))

### 🧹 Chores

- Remove friction from the initial EAS update setup. ([#1479](https://github.com/expo/eas-cli/pull/1479) by [@byCedric](https://github.com/byCedric))
- Improve choice formatting when selecting a build to submit in the `eas submit` command. ([#1502](https://github.com/expo/eas-cli/pull/1502) by [@szdziedzic](https://github.com/szdziedzic))

## [2.6.0](https://github.com/expo/eas-cli/releases/tag/v2.6.0) - 2022-10-27

### 🎉 New features

- Add custom metadata validation command with more complex rules. ([#1416](https://github.com/expo/eas-cli/pull/1416) by [@byCedric](https://github.com/byCedric))
- Add `eas build:run` command which runs iOS simulator builds from the CLI. ([#1447](https://github.com/expo/eas-cli/pull/1447) by [@szdziedzic](https://github.com/szdziedzic))
- Add feature gate support. ([#1475](https://github.com/expo/eas-cli/pull/1475) by [@wschurman](https://github.com/wschurman))
- Warn about outdated build deployment when configuring EAS Update. ([#1467](https://github.com/expo/eas-cli/pull/1467) by [@fiberjw](https://github.com/fiberjw))

### 🧹 Chores

- Replace `secret:list` table with formatted fields. ([#1464](https://github.com/expo/eas-cli/pull/1464) by [@byCedric](https://github.com/byCedric))
- Replace `device:create` input table with formatted fields. ([#1465](https://github.com/expo/eas-cli/pull/1465) by [@byCedric](https://github.com/byCedric))
- Replace `channel:view` table with formatted fields. ([#1466](https://github.com/expo/eas-cli/pull/1466) by [@byCedric](https://github.com/byCedric))
- Upgrade dependencies. ([#1480](https://github.com/expo/eas-cli/pull/1480) by [@dsokal](https://github.com/dsokal))
- Replace all remaining tables with formatted fields. ([#1481](https://github.com/expo/eas-cli/pull/1481) by [@byCedric](https://github.com/byCedric))

## [2.5.1](https://github.com/expo/eas-cli/releases/tag/v2.5.1) - 2022-10-24

### 🐛 Bug fixes

- Revert using local CLI for `expo export` ([#1460](https://github.com/expo/eas-cli/pull/1460)). ([#1472](https://github.com/expo/eas-cli/pull/1472) by [@dsokal](https://github.com/dsokal))

## [2.5.0](https://github.com/expo/eas-cli/releases/tag/v2.5.0) - 2022-10-24

### 🎉 New features

- Update init command to handle slug and owner. ([#1452](https://github.com/expo/eas-cli/pull/1452) by [@wschurman](https://github.com/wschurman))
- Add `eas secret:push`. ([#1457](https://github.com/expo/eas-cli/pull/1457) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Initialize analytics consistently and move analytics into context. ([#1444](https://github.com/expo/eas-cli/pull/1444) by [@wschurman](https://github.com/wschurman))
- - Skip using `--non-interactive` and `--experimental-bundle` flags when local Expo CLI is installed. ([#1460](https://github.com/expo/eas-cli/pull/1460) by [@EvanBacon](https://github.com/EvanBacon))

### 🧹 Chores

- Handle case where git is installed but not working properly. ([#1454](https://github.com/expo/eas-cli/pull/1454) by [@brentvatne](https://github.com/brentvatne))
- Remove table logging in `update:view`. ([#1463](https://github.com/expo/eas-cli/pull/1463) by [@EvanBacon](https://github.com/EvanBacon))
- Fix install prompt language. ([#1462](https://github.com/expo/eas-cli/pull/1462) by [@EvanBacon](https://github.com/EvanBacon))

## [2.4.1](https://github.com/expo/eas-cli/releases/tag/v2.4.1) - 2022-10-17

### 🐛 Bug fixes

- Bump `eas-cli-local-build-plugin` to 0.0.144 to not require `yarn` for local builds. ([c05ef](https://github.com/expo/eas-cli/commit/c05ef9cccaa819d8e5fb84858cb09cadaae90134) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Remove EAS Submit errors from codebase. The errors have been moved to the server side. ([#1443](https://github.com/expo/eas-cli/pull/1443) by [@dsokal](https://github.com/dsokal))

## [2.4.0](https://github.com/expo/eas-cli/releases/tag/v2.4.0) - 2022-10-14

### 🎉 New features

- Handle more common errors for EAS Submit. ([#1440](https://github.com/expo/eas-cli/pull/1440) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Move graphql and session into command context. ([#1435](https://github.com/expo/eas-cli/pull/1435), [#1436](https://github.com/expo/eas-cli/pull/1436) by [@wschurman](https://github.com/wschurman))

## [2.3.0](https://github.com/expo/eas-cli/releases/tag/v2.3.0) - 2022-10-10

### 🎉 New features

- Add new experimental resource class for M1 Macs. ([#1425](https://github.com/expo/eas-cli/pull/1425) by [@szdziedzic](https://github.com/szdziedzic))

## [2.2.1](https://github.com/expo/eas-cli/releases/tag/v2.2.1) - 2022-10-05

### 🐛 Bug fixes

- Make Apple Platform detection more robust. ([#1417](https://github.com/expo/eas-cli/pull/1417) by [@quinlanj](https://github.com/quinlanj))
- Fix creating EAS secret from file. ([#1423](https://github.com/expo/eas-cli/pull/1423) by [@dsokal](https://github.com/dsokal))

## [2.2.0](https://github.com/expo/eas-cli/releases/tag/v2.2.0) - 2022-10-04

### 🛠 Breaking changes

- Prompt before configuring EAS project. ([#1356](https://github.com/expo/eas-cli/pull/1356) by [@wschurman](https://github.com/wschurman))
- Adds paginated support to device commands. Removes the ability to delete multiple devices at once. ([#1381](https://github.com/expo/eas-cli/pull/1381) by [@kgc00](https://github.com/kgc00))

### 🎉 New features

- Add `-e` as a shortcut for `--profile` flag. ([#1342](https://github.com/expo/eas-cli/pull/1342) by [@szdziedzic](https://github.com/szdziedzic))
- Support JSON5 in **eas.json**. ([#1350](https://github.com/expo/eas-cli/pull/1350) by [@dsokal](https://github.com/dsokal))
- Add pagination and interactivity to update commands. ([#1323](https://github.com/expo/eas-cli/pull/1323) by [@kgc00](https://github.com/kgc00))
- Add support for uploading files to EAS Secret. ([#1354](https://github.com/expo/eas-cli/pull/1354) by [@dsokal](https://github.com/dsokal))
- Add pagination to channel commands. ([#1352](https://github.com/expo/eas-cli/pull/1352) by [@kgc00](https://github.com/kgc00))
- Add pagination to build commands. ([#1353](https://github.com/expo/eas-cli/pull/1353) by [@kgc00](https://github.com/kgc00))
- Provide suggestions for developers when archive size is large. ([#1363](https://github.com/expo/eas-cli/pull/1363) by [@szdziedzic](https://github.com/szdziedzic))
- Improve `eas init` command. ([#1376](https://github.com/expo/eas-cli/pull/1376) by [@wschurman](https://github.com/wschurman))
- Warn about outdated channel configuration before build when using eas update. ([#1397](https://github.com/expo/eas-cli/pull/1397) by [@kbrandwijk](https://github.com/kbrandwijk))
- Validate that owner and projectId and slug all are in alignment. ([#1405](https://github.com/expo/eas-cli/pull/1405) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Fix automatic eas.json generation when running `eas build`. ([#1415](https://github.com/expo/eas-cli/pull/1415) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Standardize the GQL 'Update' schema using UpdateFragmentNode. ([#1348](https://github.com/expo/eas-cli/pull/1348) by [@kgc00](https://github.com/kgc00))
- Remove 'owner' app config field dependency. ([#1368](https://github.com/expo/eas-cli/pull/1368), [#1369](https://github.com/expo/eas-cli/pull/1369), [#1371](https://github.com/expo/eas-cli/pull/1371), [#1372](https://github.com/expo/eas-cli/pull/1372), [#1373](https://github.com/expo/eas-cli/pull/1373) by [@wschurman](https://github.com/wschurman))
- Add Xcode 14 image. ([#1365](https://github.com/expo/eas-cli/pull/1365) by [@szdziedzic](https://github.com/szdziedzic))
- Update max `versionCode` for Android. ([#1400](https://github.com/expo/eas-cli/pull/1400) by [@wkozyra95](https://github.com/wkozyra95))
- Add and use command context to declare command dependencies. ([#1383](https://github.com/expo/eas-cli/pull/1383), [#1384](https://github.com/expo/eas-cli/pull/1384), [#1387](https://github.com/expo/eas-cli/pull/1387), [#1388](https://github.com/expo/eas-cli/pull/1388), [#1390](https://github.com/expo/eas-cli/pull/1390), [#1391](https://github.com/expo/eas-cli/pull/1391), [#1394](https://github.com/expo/eas-cli/pull/1394), [#1402](https://github.com/expo/eas-cli/pull/1402), [#1403](https://github.com/expo/eas-cli/pull/1403) by [@wschurman](https://github.com/wschurman))
- Fix typo in the ad hoc build message. ([#1407](https://github.com/expo/eas-cli/pull/1407) by [@Simek](https://github.com/Simek))
- Improve errors and error messages formatting related to **eas.json**. ([#1414](https://github.com/expo/eas-cli/pull/1414) by [@Simek](https://github.com/Simek))
- Handle errors from platform-specific kill switches to disable free tier builds. ([#1401](https://github.com/expo/eas-cli/pull/1401) by [@szdziedzic](https://github.com/szdziedzic))
- Surface invalid eas.json errors in an optional project context. ([#1418](https://github.com/expo/eas-cli/pull/1418) by [@quinlanj](https://github.com/quinlanj))
- Improve message when project ID doesn't match either slug or owner. ([#1420](https://github.com/expo/eas-cli/pull/1420) by [@brentvatne](https://github.com/brentvatne))

## [2.1.0](https://github.com/expo/eas-cli/releases/tag/v2.1.0) - 2022-09-05

### 🎉 New features

- Add tvOS credentials compatibility for Adhoc and App store builds. ([#1325](https://github.com/expo/eas-cli/pull/1325) by [@quinlanj](https://github.com/quinlanj))
- Add `eas open` command for opening project page in web browser. ([#1337](https://github.com/expo/eas-cli/pull/1337) by [@dsokal](https://github.com/dsokal))
- Add support for buildArtifactPaths. Rename artifactPath to applicationArchivePath. ([#1321](https://github.com/expo/eas-cli/pull/1321) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix viewing branch list when a branch has no associated platforms. ([#1326](https://github.com/expo/eas-cli/pull/1326) by [@hbiede](https://github.com/hbiede))
- Fix description of `help` command in help prompt. ([#1341](https://github.com/expo/eas-cli/pull/1341) by [@Simek](https://github.com/Simek))
- Resolve paths from the root when checking for gitignored values. ([#1336](https://github.com/expo/eas-cli/pull/1336) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Add noImplicitOverride to tsconfigs. ([#1327](https://github.com/expo/eas-cli/pull/1327) by [@wschurman](https://github.com/wschurman))
- Fix typos. ([#1340](https://github.com/expo/eas-cli/pull/1340) by [@hbiede](https://github.com/hbiede))

## [2.0.0](https://github.com/expo/eas-cli/releases/tag/v2.0.0) - 2022-09-01

### 🛠 Breaking changes

- Fix typo in `cli.promptToConfigurePushNotifications` field in **eas.json**. EAS CLI will throw an error if the old field name is in **eas.json**. ([#1332](https://github.com/expo/eas-cli/pull/1332) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix dynamic config update warning. ([#1322](https://github.com/expo/eas-cli/pull/1322) by [@wschurman](https://github.com/wschurman))

## [1.2.0](https://github.com/expo/eas-cli/releases/tag/v1.2.0) - 2022-08-29

### 🎉 New features

- Add 2022 Apple capabilities. ([#1307](https://github.com/expo/eas-cli/pull/1307) by [@EvanBacon](https://github.com/EvanBacon))
- Print warning when eas-cli is installed as project dependency. ([#1310](https://github.com/expo/eas-cli/pull/1310) by [@dsokal](https://github.com/dsokal))
- Add eas.json to skip push notifications credentials setup. ([#1315](https://github.com/expo/eas-cli/pull/1315) by [@dsokal](https://github.com/dsokal))
- Warn about EAS outages when running `build`, `submit`, and `update` commands. ([#1312](https://github.com/expo/eas-cli/pull/1312) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Replace promptToCreateProjectIfNotExistsAsync with getProjectIdAsync. ([#1303](https://github.com/expo/eas-cli/pull/1303) by [@wschurman](https://github.com/wschurman))
- Use AppQuery instead of ProjectQuery. ([#1304](https://github.com/expo/eas-cli/pull/1304) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Improve instructions on setting `extra.eas.projectId` in app configuration. ([#1316](https://github.com/expo/eas-cli/pull/1316) by [@dsokal](https://github.com/dsokal))
- Improve copy in EAS Submit - "e-mail" -> email, and make the link to app on App Store go directly to the TestFlight tab. ([#1318](https://github.com/expo/eas-cli/pull/1318) by [@brentvatne](https://github.com/brentvatne))

## [1.1.1](https://github.com/expo/eas-cli/releases/tag/v1.1.1) - 2022-08-23

### 🎉 New features

- Add support for `autoIncrement` option at the root of the build profile. ([#1298](https://github.com/expo/eas-cli/pull/1298) by [@szdziedzic](https://github.com/szdziedzic))

### 🐛 Bug fixes

- Handle trailing backslash in `.gitignore`. ([#1306](https://github.com/expo/eas-cli/pull/1306) by [@wkozyra95](https://github.com/wkozyra95))
- Retry ASC Api Key downloads if it has not fully propagated on Apple's infrastructure. ([#1302](https://github.com/expo/eas-cli/pull/1302) by [@quinlanj](https://github.com/quinlanj))

## [1.1.0](https://github.com/expo/eas-cli/releases/tag/v1.1.0) - 2022-08-23

### 🎉 New features

- Add support for passing platform flag to `credentials` command. ([#1277](https://github.com/expo/eas-cli/pull/1277) by [@Simek](https://github.com/Simek))

### 🐛 Bug fixes

- Prevent throwing dynamic app config write error when configuring project ID. ([#1301](https://github.com/expo/eas-cli/pull/1301) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Remove unused dependency and devDependency from the CLI. ([#1297](https://github.com/expo/eas-cli/pull/1297) by [@Simek](https://github.com/Simek))

## [1.0.0](https://github.com/expo/eas-cli/releases/tag/v1.0.0) - 2022-08-22

### 🛠 Breaking changes

- Remove timeout when waiting for build / submission. ([#1289](https://github.com/expo/eas-cli/pull/1289) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Add metadata support for dynamic store.config.js files. ([#1270](https://github.com/expo/eas-cli/pull/1270) by [@byCedric](https://github.com/byCedric))
- Improve reliability of update asset presigned upload requests. ([#1278](https://github.com/expo/eas-cli/pull/1278) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Rebind `console.info` correctly after `ora` instance stops. ([#1113](https://github.com/expo/eas-cli/pull/1113) by [@EvanBacon](https://github.com/EvanBacon))
- Fix initializing git repository in monorepo. ([#1279](https://github.com/expo/eas-cli/pull/1279) by [@dsokal](https://github.com/dsokal))
- Limit the number of SignedAssetUploadSpecifications fetched at a time. ([#1287](https://github.com/expo/eas-cli/pull/1287) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Remove unused install script. ([#1280](https://github.com/expo/eas-cli/pull/1280), [#1281](https://github.com/expo/eas-cli/pull/1281) by [@wkozyra95](https://github.com/wkozyra95))
- Remove "please" from output ([#1250](https://github.com/expo/eas-cli/pull/1250) by [@jonsamp](https://github.com/jonsamp))

## [0.60.0](https://github.com/expo/eas-cli/releases/tag/v0.60.0) - 2022-08-12

### 🎉 New features

- Add `appVersion` runtime policy. ([#1267](https://github.com/expo/eas-cli/pull/1267) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Add JSON Schema `metadataPath` to iOS submission profile. ([#1269](https://github.com/expo/eas-cli/pull/1269) by [@byCedric](https://github.com/byCedric))
- Add warning when `appVersion` runtime policy is not supported. ([#1271](https://github.com/expo/eas-cli/pull/1271) by [@wkozyra95](https://github.com/wkozyra95))

## [0.59.0](https://github.com/expo/eas-cli/releases/tag/v0.59.0) - 2022-08-10

### 🐛 Bug fixes

- Fix building Android projects locally that don't have execute permissions set for `gradlew`. ([82231](https://github.com/expo/eas-cli/commit/822313e90e94bd6ddd3872061a0c25a8aa4db7cd) by [@dsokal](https://github.com/dsokal))
- Disable `nativeVersion` policy only for remote version source. ([#1261](https://github.com/expo/eas-cli/pull/1261) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Improve wording on version auto-increment. ([#1260](https://github.com/expo/eas-cli/pull/1260) by [@wkozyra95](https://github.com/wkozyra95))
- Upgrade dependencies. ([#1262](https://github.com/expo/eas-cli/pull/1262) by [@dsokal](https://github.com/dsokal))

## [0.58.0](https://github.com/expo/eas-cli/releases/tag/v0.58.0) - 2022-08-09

### 🎉 New features

- Managed app versions support. ([#1209](https://github.com/expo/eas-cli/pull/1209), [#1219](https://github.com/expo/eas-cli/pull/1219), [#1232](https://github.com/expo/eas-cli/pull/1232) by [@wkozyra95](https://github.com/wkozyra95))
- Add a warning when publishing an update with too many assets. ([#1243](https://github.com/expo/eas-cli/pull/1243) by [@kgc00](https://github.com/kgc00))
- Add submission info when building with `--json` option. ([#1246](https://github.com/expo/eas-cli/pull/1246) by [@wkozyra95](https://github.com/wkozyra95))
- Set all environment variables (documented in https://docs.expo.dev/build-reference/variables/) when running local build. ([#1256](https://github.com/expo/eas-cli/pull/1256) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Do not include sources in `eas-json` npm package. ([#1248](https://github.com/expo/eas-cli/pull/1248) by [@wkozyra95](https://github.com/wkozyra95))
- Swallow error when unable to track file in no commit workflow. ([#1109](https://github.com/expo/eas-cli/pull/1109) by [@brentvatne](https://github.com/brentvatne))

## [0.57.0](https://github.com/expo/eas-cli/releases/tag/v0.57.0) - 2022-08-03

### 🎉 New features

- Add new option to `eas device:create` - allow importing devices from Apple Developer Portal. ([#1236](https://github.com/expo/eas-cli/pull/1236) by [@dsokal](https://github.com/dsokal))
- Add support for attaching messages to builds. ([#1237](https://github.com/expo/eas-cli/pull/1237) by [@dsokal](https://github.com/dsokal))
- Introduce interactive pagination for `branch` commands. ([#1213](https://github.com/expo/eas-cli/pull/1213) by [@kgc00](https://github.com/kgc00))

## [0.56.0](https://github.com/expo/eas-cli/releases/tag/v0.56.0) - 2022-07-28

### 🎉 New features

- Display build queue type when waiting. ([#1217](https://github.com/expo/eas-cli/pull/1217) by [@dsokal](https://github.com/dsokal))
- Add better message on how to upgrade EAS CLI. ([#1222](https://github.com/expo/eas-cli/pull/1222) by [@jeremybarbet](https://github.com/jeremybarbet), [#1231](https://github.com/expo/eas-cli/pull/1231) by [@wkozyra95](https://github.com/wkozyra95))
- Invoke export with sourcemaps on update. ([#1228](https://github.com/expo/eas-cli/pull/1228) by [@kbrandwijk](https://github.com/kbrandwijk))

### 🐛 Bug fixes

- Show spinner instead of silently timing out during asset upload. ([#1206](https://github.com/expo/eas-cli/pull/1206) by [@wschurman](https://github.com/wschurman))
- Fix build archive S3 URLs. ([#1207](https://github.com/expo/eas-cli/pull/1207) by [@dsokal](https://github.com/dsokal))
- `autoIncrement` option on iOS will update versions of all targets that depend on an application target. ([#1219](https://github.com/expo/eas-cli/pull/1219) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Increase max number of chained "extends" in build profiles. ([#1208](https://github.com/expo/eas-cli/pull/1208) by [@wkozyra95](https://github.com/wkozyra95))
- Change wording on build warning for bundle id/package name. ([#1211](https://github.com/expo/eas-cli/pull/1211) by [@kbrandwijk](https://github.com/kbrandwijk))

## [0.55.1](https://github.com/expo/eas-cli/releases/tag/v0.55.1) - 2022-07-12

### 🐛 Bug fixes

- Fix asset upload crash. ([#1205](https://github.com/expo/eas-cli/pull/1205) by [@wschurman](https://github.com/wschurman))

## [0.55.0](https://github.com/expo/eas-cli/releases/tag/v0.55.0) - 2022-07-11

### 🎉 New features

- Show bundler output by default for eas update command. ([#1171](https://github.com/expo/eas-cli/pull/1171) by [@kgc00](https://github.com/kgc00))
- Allow users to skip metadata validation. ([#1175](https://github.com/expo/eas-cli/pull/1175) by [@byCedric](https://github.com/byCedric))
- Add experimental `--resource-class` flag for Build commands. ([#1138](https://github.com/expo/eas-cli/pull/1138) by [@christopherwalter](https://github.com/christopherwalter))
- Truncate long messages for `eas update` command, rather than failing. ([#1178](https://github.com/expo/eas-cli/pull/1178) by [@kgc00](https://github.com/kgc00))
- Add review details to metadata store configuration. ([#1184](https://github.com/expo/eas-cli/pull/1184) by [@byCedric](https://github.com/byCedric))
- Override applicationId via env. ([#1203](https://github.com/expo/eas-cli/pull/1203) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix submission archive URLs. ([#1179](https://github.com/expo/eas-cli/pull/1179) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Update validation rules for metadata info locales. ([#1174](https://github.com/expo/eas-cli/pull/1174) by [@byCedric](https://github.com/byCedric))
- Improve store configuration defaults and schema documentation. ([#1183](https://github.com/expo/eas-cli/pull/1183) by [@byCedric](https://github.com/byCedric))
- Improve store config categories configuration. ([#1187](https://github.com/expo/eas-cli/pull/1187) by [@byCedric](https://github.com/byCedric))
- Remove deprecated idfa and price tier from store config. ([#1193](https://github.com/expo/eas-cli/pull/1193) by [@byCedric](https://github.com/byCedric))

## [0.54.1](https://github.com/expo/eas-cli/releases/tag/v0.54.1) - 2022-06-15

### 🎉 New features

- Add App Store Connect link after `eas metadata:push`. ([#1168](https://github.com/expo/eas-cli/pull/1168) by [@byCedric](https://github.com/byCedric))

### 🐛 Bug fixes

- Surface ASC errors in metadata for normal API rejections. ([#1167](https://github.com/expo/eas-cli/pull/1167) by [@byCedric](https://github.com/byCedric))
- Add metadata schema to bundled eas-cli package. ([#1166](https://github.com/expo/eas-cli/pull/1166) by [@byCedric](https://github.com/byCedric))

## [0.54.0](https://github.com/expo/eas-cli/releases/tag/v0.54.0) - 2022-06-15

### 🛠 Breaking changes

- Remove fallback for legacy format in `eas.json`. ([#1158](https://github.com/expo/eas-cli/pull/1158), [#1163](https://github.com/expo/eas-cli/pull/1163) by [@wkozyra95](https://github.com/wkozyra95))

### 🎉 New features

- `eas update` now provides more information about the publish process including real-time feedback on asset uploads, update ids, and website links. ([#1152](https://github.com/expo/eas-cli/pull/1152) by [@kgc00](https://github.com/kgc00))
- Added first beta of `eas metadata` to sync store information using store configuration files ([#1136](https://github.com/expo/eas-cli/pull/1136) by [@bycedric](https://github.com/bycedric))

### 🐛 Bug fixes

- Improved support for working on branches with many updates. ([#1144](https://github.com/expo/eas-cli/pull/1144), [#1148](https://github.com/expo/eas-cli/pull/1148) by [@kgc00](https://github.com/kgc00))
- `eas update` project links no longer contain a `)` on unsupported terminals. ([#1152](https://github.com/expo/eas-cli/pull/1152) by [@kgc00](https://github.com/kgc00))

### 🧹 Chores

- Update `eas-build-job`. ([#1162](https://github.com/expo/eas-cli/pull/1162) by [@wkozyra95](https://github.com/wkozyra95))

## [0.53.1](https://github.com/expo/eas-cli/releases/tag/v0.53.1) - 2022-06-07

### 🐛 Bug fixes

- No longer timeout on publishing updates for branches with many updates. ([#1119](https://github.com/expo/eas-cli/pull/1119) by [@kgc00](https://github.com/kgc00))

### 🧹 Chores

- Display project archive docs before compressing/uploading to EAS Build. ([#1127](https://github.com/expo/eas-cli/pull/1127) by [@dsokal](https://github.com/dsokal))
- Add new common error code for submits. ([#1129](https://github.com/expo/eas-cli/pull/1129) by [@dsokal](https://github.com/dsokal))

## [0.53.0](https://github.com/expo/eas-cli/releases/tag/v0.53.0) - 2022-05-30

### 🛠 Breaking changes

- Drop support for Node < 14. ([#1098](https://github.com/expo/eas-cli/pull/1098) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Match bundle identifier capabilities more accurately. ([#1112](https://github.com/expo/eas-cli/pull/1112) by [@EvanBacon](https://github.com/EvanBacon))
- Limit concurrent asset uploads. ([#1153](https://github.com/expo/eas-cli/pull/1153) by [@wschurman](https://github.com/wschurman))

### 🧹 Chores

- Update dependencies. ([#1095](https://github.com/expo/eas-cli/pull/1095), [#1115](https://github.com/expo/eas-cli/pull/1115) by [@dsokal](https://github.com/dsokal))
- Better spinner placement for multiple builds. ([#1105](https://github.com/expo/eas-cli/pull/1105) by [@dsokal](https://github.com/dsokal))
- Use getExpoConfig to access config. ([#1122](https://github.com/expo/eas-cli/pull/1122) by [@wkozyra95](https://github.com/wkozyra95))

## [0.52.0](https://github.com/expo/eas-cli/releases/tag/v0.52.0) - 2022-04-26

### 🎉 New features

- Support target specific entitlements. ([#1078](https://github.com/expo/eas-cli/pull/1078) by [@wkozyra95](https://github.com/wkozyra95))

## [0.51.0](https://github.com/expo/eas-cli/releases/tag/v0.51.0) - 2022-04-19

### 🎉 New features

- Add non-interactive flag to eas update command. ([#1066](https://github.com/expo/eas-cli/pull/1066) by [@wschurman](https://github.com/wschurman))
- Handle new EAS Submit common error - expired Apple's certificates. ([#1068](https://github.com/expo/eas-cli/pull/1068) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Enable full bundling logging for eas update when debugging. ([#1070](https://github.com/expo/eas-cli/pull/1070) by [@byCedric](https://github.com/byCedric))

### 🧹 Chores

- Upgrade `@expo/apple-utils@0.0.0-alpha.31` (now with license). ([#1064](https://github.com/expo/eas-cli/pull/1064) by [@EvanBacon](https://github.com/EvanBacon))
- Unify Google Service Account key prompts. ([#1063](https://github.com/expo/eas-cli/pull/1063) by [@dsokal](https://github.com/dsokal))

## [0.50.0](https://github.com/expo/eas-cli/releases/tag/v0.50.0) - 2022-04-11

### 🎉 New features

- Provide queue position progress and estimated wait time. ([#1049](https://github.com/expo/eas-cli/pull/1049), [#1058](https://github.com/expo/eas-cli/pull/1058) by [@dsokal](https://github.com/dsokal))
- Enable App Store authentication for ASC Api Keys with environment variables. ([#1051](https://github.com/expo/eas-cli/pull/1051) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Prompt for user/password authentication where required. ([#1055](https://github.com/expo/eas-cli/pull/1055) by [@quinlanj](https://github.com/quinlanj))
- Require private-key-path to be specified for updating when code signing configured. ([#1059](https://github.com/expo/eas-cli/pull/1059) by [@wschurman](https://github.com/wschurman))

## [0.49.0](https://github.com/expo/eas-cli/releases/tag/v0.49.0) - 2022-04-05

### 🎉 New features

- Added experimental App Store Connect API provisioning profile regeneration. ([#1038](https://github.com/expo/eas-cli/pull/1038) by [@EvanBacon](https://github.com/EvanBacon))
- Experimental support for iOS App Extensions in managed projects. ([#1039](https://github.com/expo/eas-cli/pull/1039) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix proxy support. ([#1032](https://github.com/expo/eas-cli/pull/1032) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Add annotations regarding App Store Connect Token session support. ([#1029](https://github.com/expo/eas-cli/pull/1029) by [@EvanBacon](https://github.com/EvanBacon))
- Upgrade dependencies. ([#1043](https://github.com/expo/eas-cli/pull/1043) by [@dsokal](https://github.com/dsokal))
- Make default deprecation message more generic. ([#1047](https://github.com/expo/eas-cli/pull/1047) by [@wkozyra95](https://github.com/wkozyra95))

## [0.48.2](https://github.com/expo/eas-cli/releases/tag/v0.48.2) - 2022-03-21

### 🎉 New features

- Add proxy support. ([#1005](https://github.com/expo/eas-cli/pull/1005) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Do not retry build requests. ([#1024](https://github.com/expo/eas-cli/pull/1024) by [@wkozyra95](https://github.com/wkozyra95))

## [0.48.1](https://github.com/expo/eas-cli/releases/tag/v0.48.1) - 2022-03-15

### 🐛 Bug fixes

- Fix code signing error when not yet configured. ([#1018](https://github.com/expo/eas-cli/pull/1018) by [@wschurman](https://github.com/wschurman))
- Fix link to build details page to use `project.slug`. ([#1021](https://github.com/expo/eas-cli/pull/1021) by [@giautm](https://github.com/giautm))

### 🧹 Chores

- Improve apple login prompt for internal distribution builds. ([#1016](https://github.com/expo/eas-cli/pull/1016) by [@wkozyra95](https://github.com/wkozyra95))

## [0.48.0](https://github.com/expo/eas-cli/releases/tag/v0.48.0) - 2022-03-14

### 🎉 New features

- Add code signing. ([#964](https://github.com/expo/eas-cli/pull/964) by [@wschurman](https://github.com/wschurman))
- Install expo-updates when running update:configure. ([#977](https://github.com/expo/eas-cli/pull/977) by [@jkhales](https://github.com/jkhales))
- Make `update:configure` work on native files. ([#978](https://github.com/expo/eas-cli/pull/978) by [@jkhales](https://github.com/jkhales))

### 🐛 Bug fixes

- Fix `"Unknown status"` error when a build is canceled. ([#1012](https://github.com/expo/eas-cli/pull/1012) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Add error message when package.json is outside git repository. ([#971](https://github.com/expo/eas-cli/pull/971) by [@wkozyra95](https://github.com/wkozyra95))
- Make runtime version policy warning on the update command more descriptive. ([#979](https://github.com/expo/eas-cli/pull/979) by [@kbrandwijk](https://github.com/kbrandwijk))
- Remove unused flag. ([#995](https://github.com/expo/eas-cli/pull/995) by [@wkozyra95](https://github.com/wkozyra95))
- Replace `got` with `node-fetch`. ([#1000](https://github.com/expo/eas-cli/pull/1000) by [@wkozyra95](https://github.com/wkozyra95))
- Upgrade dependencies. ([#1015](https://github.com/expo/eas-cli/pull/1015) by [@dsokal](https://github.com/dsokal))

## [0.47.0](https://github.com/expo/eas-cli/releases/tag/v0.47.0) - 2022-02-08

### 🐛 Bug fixes

- Return informative error when running `eas channel:rollout` with a channel that does not exist. ([#930](https://github.com/expo/eas-cli/pull/930) by [@jkhales](https://github.com/jkhales))
- Check if `expo-updates` is installed before publish. ([#953](https://github.com/expo/eas-cli/pull/953) by [@jkhales](https://github.com/jkhales))

### 🧹 Chores

- Upgrade dependencies. ([#946](https://github.com/expo/eas-cli/pull/946) by [@dsokal](https://github.com/dsokal))

## [0.46.0](https://github.com/expo/eas-cli/releases/tag/v0.46.0) - 2022-01-26

### 🛠 Breaking changes

- Drop support for building iOS builds on macOS Catalina. ([#939](https://github.com/expo/eas-cli/pull/939) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix URL placeholder for iOS submits. ([#941](https://github.com/expo/eas-cli/pull/941) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Unify EAS command descriptions style. ([#925](https://github.com/expo/eas-cli/pull/925) by [@dsokal](https://github.com/dsokal))
- Upgrade dependencies. ([#939](https://github.com/expo/eas-cli/pull/939) by [@dsokal](https://github.com/dsokal))

## [0.45.1](https://github.com/expo/eas-cli/releases/tag/v0.45.1) - 2022-01-19

### 🎉 New features

- Add json output for started builds when using `--no-wait`. ([#921](https://github.com/expo/eas-cli/pull/921) by [@kbrandwijk](https://github.com/kbrandwijk))
- Add support to `eas build` for specifying a custom `prebuildCommand` in `eas.json`. ([#919](https://github.com/expo/eas-cli/pull/919) by [@kbrandwijk](https://github.com/kbrandwijk))

### 🧹 Chores

- Add macOS Monterey image. ([#922](https://github.com/expo/eas-cli/pull/922) by [@wkozyra95](https://github.com/wkozyra95))

## [0.45.0](https://github.com/expo/eas-cli/releases/tag/v0.45.0) - 2022-01-18

### 🎉 New features

- Add `eas device:delete`. ([#890](https://github.com/expo/eas-cli/pull/890) by [@kbrandwijk](https://github.com/kbrandwijk))

### 🧹 Chores

- Upgrade dependencies. ([#872](https://github.com/expo/eas-cli/pull/872) by [@dsokal](https://github.com/dsokal))

## [0.44.1](https://github.com/expo/eas-cli/releases/tag/v0.44.1) - 2022-01-11

### 🐛 Bug fixes

- Fix build:configure expo-updates configuration to only run on generic projects. ([#904](https://github.com/expo/eas-cli/pull/904) by [@brentvatne](https://github.com/brentvatne))

### 🧹 Chores

- Upgrade `node-forge` to 1.0.0. ([#902](https://github.com/expo/eas-cli/pull/902) by [@dependabot](https://github.com/apps/dependabot), [@dsokal](https://github.com/dsokal))
- Replace `@expo/plugin-autocomplete` with `@oclif/plugin-autocomplete`. Upgrade oclif deps. ([#903](https://github.com/expo/eas-cli/pull/903) by [@dsokal](https://github.com/dsokal))

## [0.44.0](https://github.com/expo/eas-cli/releases/tag/v0.44.0) - 2022-01-11

### 🛠 Breaking changes

- No longer enable APNS (iOS Push Notifications) capability by default anymore. ([#797](https://github.com/expo/eas-cli/pull/797) by [@EvanBacon](https://github.com/EvanBacon))
- Don't configure Android projects locally. Clean up old Gradle signing config. Streamline `expo-updates` configuration. ([#888](https://github.com/expo/eas-cli/pull/888) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Add `update:list` command. ([#884](https://github.com/expo/eas-cli/pull/884) by [@jkhales](https://github.com/jkhales))
- Improve error message for outdated Apple PLA error. ([#889](https://github.com/expo/eas-cli/pull/889) by [@EvanBacon](https://github.com/EvanBacon))
- Add `--output` flag to the build command. ([#885](https://github.com/expo/eas-cli/pull/885) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix creating project archive with symlink cycle. ([#891](https://github.com/expo/eas-cli/pull/891) by [@wkozyra95](https://github.com/wkozyra95))
- Sign Android debug builds with the correct keystore. Previously, all debug builds would be signed with a default debug keystore. ([#888](https://github.com/expo/eas-cli/pull/888) by [@dsokal](https://github.com/dsokal))

## [0.43.0](https://github.com/expo/eas-cli/releases/tag/v0.43.0) - 2022-01-03

### 🎉 New features

- Add `eas channel:delete`. ([#846](https://github.com/expo/eas-cli/pull/846), [#869](https://github.com/expo/eas-cli/pull/869) by [@jkhales](https://github.com/jkhales))
- Add `eas autocomplete`. ([#870](https://github.com/expo/eas-cli/pull/870) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix saving `build:inspect` results to project subdirectory. ([#863](https://github.com/expo/eas-cli/pull/863) by [@wkozyra95](https://github.com/wkozyra95))

## [0.42.4](https://github.com/expo/eas-cli/releases/tag/v0.42.4) - 2021-12-21

### 🐛 Bug fixes

- Add missing dependency - `@oclif/plugin-help`. ([#865](https://github.com/expo/eas-cli/pull/865) by [@dsokal](https://github.com/dsokal))

## [0.42.3](https://github.com/expo/eas-cli/releases/tag/v0.42.3) - 2021-12-21

### 🐛 Bug fixes

- Allow select eas commands to be run outside of a project. ([#851](https://github.com/expo/eas-cli/pull/851) by [@jkhales](https://github.com/jkhales))

### 🧹 Chores

- Replace all oclif dependencies with `@oclif/core`. ([#858](https://github.com/expo/eas-cli/pull/858) by [@dsokal](https://github.com/dsokal))

## [0.41.1](https://github.com/expo/eas-cli/releases/tag/v0.41.1) - 2021-12-16

### 🎉 New features

- Adds commands for EAS Update, which is now in preview for subscribers. EAS Update makes fixing small bugs and pushing quick fixes a snap in between app store submissions. It accomplishes this by allowing an end-user's app to swap out the non-native parts of their app (for example, JS, styling, and image changes) with a new update that contains bug fixes and other updates. ([#854](https://github.com/expo/eas-cli/pull/854) by [@jonsamp](https://github.com/jonsamp))
  - Adds `eas update`, which can bundle and publish updates on a branch.
  - Adds `eas branch`, which manages branches. Branches contain a list of updates and are linked to channels.
  - Adds `eas channel`, which manages channels. Channels are specified inside builds and are linked to branches, allowing us to link specific updates with specific builds.
  - Read more in our [feature preview docs](https://docs.expo.dev/eas-update/introduction/).

### 🐛 Bug fixes

- Fix `eas submit` displaying a prompt in non-interactive mode when some ASC API credentials are missing in `eas.json`. ([#841](https://github.com/expo/eas-cli/pull/841) by [@barthap](https://github.com/barthap))

## [0.41.0](https://github.com/expo/eas-cli/releases/tag/v0.41.0) - 2021-12-13

### 🎉 New features

- Ask user to select profile if `release` does not exist. ([#829](https://github.com/expo/eas-cli/pull/829) by [@dsokal](https://github.com/dsokal))
- Add `build:inspect` command. ([#834](https://github.com/expo/eas-cli/pull/834) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix validating tool versions in eas.json. ([#832](https://github.com/expo/eas-cli/pull/832) by [@dsokal](https://github.com/dsokal))
- Fix submission URL. ([#845](https://github.com/expo/eas-cli/pull/845) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Warn when building managed project with SDK < 41. ([#833](https://github.com/expo/eas-cli/pull/833) by [@dsokal](https://github.com/dsokal))

## [0.40.0](https://github.com/expo/eas-cli/releases/tag/v0.40.0) - 2021-12-08

### 🛠 Breaking changes

- [eas-cli] change eas update:publish to eas update. ([#830](https://github.com/expo/eas-cli/pull/830) by [@jkhales](https://github.com/jkhales))

### 🐛 Bug fixes

- Pass build profile environment to credentials command. ([#828](https://github.com/expo/eas-cli/pull/828) by [@quinlanj](https://github.com/quinlanj))

## [0.39.0](https://github.com/expo/eas-cli/releases/tag/v0.39.0) - 2021-12-06

### 🎉 New features

- Set runtime version in `eas update:configure`. ([#811](https://github.com/expo/eas-cli/pull/811) by [@jkhales](https://github.com/jkhales))
- Print project workflow in `eas diagnostics`. ([#822](https://github.com/expo/eas-cli/pull/822) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix submit for multi-target projects where ascAppId is not specified. ([#809](https://github.com/expo/eas-cli/pull/809) by [@wkozyra95](https://github.com/wkozyra95))
- Fix building iOS projects with Apple Watch companion app. ([#812](https://github.com/expo/eas-cli/pull/812), [#817](https://github.com/expo/eas-cli/pull/817), [#821](https://github.com/expo/eas-cli/pull/821) by [@jkhales](https://github.com/jkhales), [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Improve error message for missing ascAppId. ([#813](https://github.com/expo/eas-cli/pull/813) by [@wkozyra95](https://github.com/wkozyra95))
- Add `react-native` version to metadata. ([#823](https://github.com/expo/eas-cli/pull/823) by [@wkozyra95](https://github.com/wkozyra95))

## [0.38.3](https://github.com/expo/eas-cli/releases/tag/v0.38.3) - 2021-11-29

### 🐛 Bug fixes

- Print warning about outdated version to stderr. ([#805](https://github.com/expo/eas-cli/pull/805) by [@wkozyra95](https://github.com/wkozyra95))
- Fix Apple sign in capabilities. ([#806](https://github.com/expo/eas-cli/pull/806) by [@brentvatne](https://github.com/brentvatne))

## [0.38.2](https://github.com/expo/eas-cli/releases/tag/v0.38.2) - 2021-11-26

### 🎉 New features

- Add support for extending submit profiles. ([#794](https://github.com/expo/eas-cli/pull/794) by [@dsokal](https://github.com/dsokal))
- Add command: `eas update:configure`. ([#800](https://github.com/expo/eas-cli/pull/800) by [@jkhales](https://github.com/jkhales))

### 🐛 Bug fixes

- Fix reading app version and app build version of iOS projects. ([#798](https://github.com/expo/eas-cli/pull/798) by [@dsokal](https://github.com/dsokal))
- Fix push notifications entitlements. ([#801](https://github.com/expo/eas-cli/pull/801) by [@brentvatne](https://github.com/brentvatne))

## [0.38.1](https://github.com/expo/eas-cli/releases/tag/v0.38.1) - 2021-11-25

### 🐛 Bug fixes

- Fix building iOS projects with whitespace in the project name. ([#792](https://github.com/expo/eas-cli/pull/792) by [@dsokal](https://github.com/dsokal))

## [0.38.0](https://github.com/expo/eas-cli/releases/tag/v0.38.0) - 2021-11-24

### 🎉 New features

- Improve unknown capability syncing error message. ([#775](https://github.com/expo/eas-cli/pull/775) by [@EvanBacon](https://github.com/EvanBacon))
- Add submit webhooks. ([#777](https://github.com/expo/eas-cli/pull/777) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Compute runtime version policies. ([#783](https://github.com/expo/eas-cli/pull/783), [#785](https://github.com/expo/eas-cli/pull/785) by [@jkhales](https://github.com/jkhales))
- Fix local builds with npm < 7. ([#787](https://github.com/expo/eas-cli/pull/787) by [@dsokal](https://github.com/dsokal))
- Override `applicationId`/`bundleIdentifier` when auto-submitting after build. ([#780](https://github.com/expo/eas-cli/pull/780) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Upgrade `typescript` to 4.5.2. Upgrade oclif dependencies. ([#781](https://github.com/expo/eas-cli/pull/781) by [@dsokal](https://github.com/dsokal))
- Make missing `git` command error message more descriptive. ([#784](https://github.com/expo/eas-cli/pull/784) by [@dsokal](https://github.com/dsokal))

## [0.37.0](https://github.com/expo/eas-cli/releases/tag/v0.37.0) - 2021-11-18

### 🛠 Breaking changes

- Require explicitly defined applicationId/bundleIdentifier for EAS Submit in case of bare projects consisting of multiple product flavors on Android or multiple schemes/targets on iOS. ([#765](https://github.com/expo/eas-cli/pull/765) by [@wkozyra95](https://github.com/wkozyra95))

### 🎉 New features

- Auto create channel on publish. ([#766](https://github.com/expo/eas-cli/pull/766) by [@jkhales](https://github.com/jkhales))
- Interactively configure Git `user.name` and `user.email`. ([#772](https://github.com/expo/eas-cli/pull/772) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Validate release channel in eas.json. ([#764](https://github.com/expo/eas-cli/pull/764) by [@dsokal](https://github.com/dsokal))
- Make the missing profile error message more descriptive. ([#761](https://github.com/expo/eas-cli/pull/761) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Better error message when missing eas.json. ([#770](https://github.com/expo/eas-cli/pull/770) by [@quinlanj](https://github.com/quinlanj))

## [0.36.1](https://github.com/expo/eas-cli/releases/tag/v0.36.1) - 2021-11-15

### 🐛 Bug fixes

- Fix `dateformat` import issue when building with `--local` flag. ([a520d](https://github.com/expo/eas-cli/commit/a520d1750736d61d6489da6487879f35ed3deb23) by [@dsokal](https://github.com/dsokal))

## [0.36.0](https://github.com/expo/eas-cli/releases/tag/v0.36.0) - 2021-11-15

### 🛠 Breaking changes

- Do not require manual `eas-cli-local-build-plugin` installation. An existing global installation (either with `yarn global add` or `npm install -g`) will not be used anymore. ([#753](https://github.com/expo/eas-cli/pull/753) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Use Keystore Service when `keytool` is not installed. ([#754](https://github.com/expo/eas-cli/pull/754) by [@dsokal](https://github.com/dsokal))
- Add applicationId/bundleIdentifier fields to the submit profile. ([#765](https://github.com/expo/eas-cli/pull/765) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix auto-submitting with `--auto-submit-with-profile`. ([#748](https://github.com/expo/eas-cli/pull/748) by [@dsokal](https://github.com/dsokal))
- Pass env from build profile when resolving entitlements. ([#751](https://github.com/expo/eas-cli/pull/751) by [@wkozyra95](https://github.com/wkozyra95))
- Only prompt for Apple Id username if authenticating with an App Specific Password. ([#745](https://github.com/expo/eas-cli/pull/745) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Use same URL paths for local development of EAS CLI as production. ([#750](https://github.com/expo/eas-cli/pull/750) by [@ide](https://github.com/ide))
- Grammar: Api -> API. ([#755](https://github.com/expo/eas-cli/pull/755) by [@quinlanj](https://github.com/quinlanj))
- Add analytics for EAS Submit. ([#752](https://github.com/expo/eas-cli/pull/752) by [@quinlanj](https://github.com/quinlanj))
- Add an 'attempt' event to build and submit analytics. ([#757](https://github.com/expo/eas-cli/pull/757) by [@quinlanj](https://github.com/quinlanj))

## [0.35.0](https://github.com/expo/eas-cli/releases/tag/v0.35.0) - 2021-11-08

### 🎉 New features

- Add ASC API Key generation workflow. ([#718](https://github.com/expo/eas-cli/pull/718) by [@quinlanj](https://github.com/quinlanj))
- Add support for removal of ASC API Keys. ([#721](https://github.com/expo/eas-cli/pull/721) by [@quinlanj](https://github.com/quinlanj))
- Allow users to assign an ASC API Key to their project. ([#719](https://github.com/expo/eas-cli/pull/719) by [@quinlanj](https://github.com/quinlanj))
- Add setup support for ASC API Keys. ([#733](https://github.com/expo/eas-cli/pull/733) by [@quinlanj](https://github.com/quinlanj))
- Show initiating user display name when selecting a build to submit. ([#730](https://github.com/expo/eas-cli/pull/730) by [@barthap](https://github.com/barthap))
- Handle Apple servers maintenance error in `eas submit`. ([#738](https://github.com/expo/eas-cli/pull/738) by [@barthap](https://github.com/barthap))
- Integrate ASC API Key with submissions workflow. ([#737](https://github.com/expo/eas-cli/pull/737) by [@quinlanj](https://github.com/quinlanj))
- Change EAS API server domain. ([#744](https://github.com/expo/eas-cli/pull/744) by [@ide](https://github.com/ide))

### 🧹 Chores

- Clean up credentials prompt method. ([#728](https://github.com/expo/eas-cli/pull/728) by [@quinlanj](https://github.com/quinlanj))
- Bump `@expo/apple-utils` to 0.0.0-alpha.26. ([#723](https://github.com/expo/eas-cli/pull/723) by [@brentvatne](https://github.com/brentvatne))
- Grammar: replace setup with set up. ([#735](https://github.com/expo/eas-cli/pull/735) by [@quinlanj](https://github.com/quinlanj))
- Improve VCS workflow migration experience. ([#732](https://github.com/expo/eas-cli/pull/732) by [@wkozyra95](https://github.com/wkozyra95))

## [0.34.1](https://github.com/expo/eas-cli/releases/tag/v0.34.1) - 2021-11-02

### 🐛 Bug fixes

- Don't show commit prompt in no-commit workflow after installing `expo-dev-client`. ([#722](https://github.com/expo/eas-cli/pull/722) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Add App Store Connect API Key graphql type and print support. ([#717](https://github.com/expo/eas-cli/pull/717) by [@quinlanj](https://github.com/quinlanj))

## [0.34.0](https://github.com/expo/eas-cli/releases/tag/v0.34.0) - 2021-11-01

### 🛠 Breaking changes

- Use new build job format. ([#701](https://github.com/expo/eas-cli/pull/701), [#711](https://github.com/expo/eas-cli/pull/711) by [@dsokal](https://github.com/dsokal))
- Don't print logs to `stderr`. ([#708](https://github.com/expo/eas-cli/pull/708) by [@dsokal](https://github.com/dsokal))
- Remove automatic migration for legacy `eas.json` format introduced in [v0.22.2](https://github.com/expo/eas-cli/releases/tag/v0.22.2). ([#695](https://github.com/expo/eas-cli/pull/695) by [@wkozyra95](https://github.com/wkozyra95))
- Implement no-commit build workflow. Add required `cli` field in root of `eas.json`. ([#695](https://github.com/expo/eas-cli/pull/695) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Better error message when eas.json is invalid. ([#707](https://github.com/expo/eas-cli/pull/707) by [@dsokal](https://github.com/dsokal))
- Fix credentials workflow for new users: add additionalTypenames for credentials. ([#703](https://github.com/expo/eas-cli/pull/703) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Add additionalTypenames for other queries. ([#704](https://github.com/expo/eas-cli/pull/704) by [@quinlanj](https://github.com/quinlanj))
- Fix errors after pulling down most recent graphql schema changes. ([#713](https://github.com/expo/eas-cli/pull/713) by [@quinlanj](https://github.com/quinlanj))
- Refactor credentials manager. ([#712](https://github.com/expo/eas-cli/pull/712) by [@quinlanj](https://github.com/quinlanj))
- Remove unneeded parameters. ([#710](https://github.com/expo/eas-cli/pull/710) by [@quinlanj](https://github.com/quinlanj))
- Enforce additionalTypenames for graphql queries. ([#709](https://github.com/expo/eas-cli/pull/709) by [@quinlanj](https://github.com/quinlanj))

## [0.33.1](https://github.com/expo/eas-cli/releases/tag/v0.33.1) - 2021-10-22

### 🎉 New features

- Compute runtime version using config-plugins. ([#697](https://github.com/expo/eas-cli/pull/697) by [@jkhales](https://github.com/jkhales))

### 🐛 Bug fixes

- [eas-cli] Skip validating updates scripts integration, which no longer exist in SDK 43+ ([#706](https://github.com/expo/eas-cli/pull/706) by [@brentvatne](https://github.com/brentvatne))

## [0.33.0](https://github.com/expo/eas-cli/releases/tag/v0.33.0) - 2021-10-20

### 🎉 New features

- Make "production" the default profile for building and submitting. ([#677](https://github.com/expo/eas-cli/pull/677) by [@jonsamp](https://github.com/jonsamp))
  - Previously, the default profile when running `eas build` or `eas submit` was "release". We're changing it to a more recognizable name that is consistent with our docs, which is now "production". You can always specify a profile manually with the `--profile` flag. For this major version, if you do not have a profile named "production", and still have a profile named "release", we will fall back to the "release" profile as the default, however you'll see a warning as we're going to remove that behavior in the next major release of EAS CLI.
  - To upgrade, update **eas.json** to have a "production" profile in both the `build` and `submit` objects. If you already have a project set up, this will replace the existing "release" profile. After the change, eas.json should have the following profiles:
    ```json
      {
        "build": {
          "production": { ... }
        },
        "submit": {
          "production": { ... }
        }
      }
    ```

### 🐛 Bug fixes

- Skip the second prompt for Apple ID if the user is already signed in with Apple. ([#691](https://github.com/expo/eas-cli/pull/691) by [@dsokal](https://github.com/dsokal))
- Unify reading `app.json`. ([#692](https://github.com/expo/eas-cli/pull/692) by [@dsokal](https://github.com/dsokal))

## [0.32.0](https://github.com/expo/eas-cli/releases/tag/v0.32.0) - 2021-10-15

### 🎉 New features

- Add App Store Connect API Key support to iOS submissions. ([#678](https://github.com/expo/eas-cli/pull/678) by [@quinlanj](https://github.com/quinlanj))
- Create/list/revoke App Store Connect Api keys via Apple apis. ([#687](https://github.com/expo/eas-cli/pull/687) by [@quinlanj](https://github.com/quinlanj))
- Add ability to select a build from a list in `eas submit` interactive mode. ([#688](https://github.com/expo/eas-cli/pull/688) by [@barthap](https://github.com/barthap))

### 🐛 Bug fixes

- Fix printing App Store Connect URL after submission. ([#683](https://github.com/expo/eas-cli/pull/683) by [@brentvatne](https://github.com/brentvatne))

### 🧹 Chores

- Add App Store Connect API Key fields to `eas.json`. ([#684](https://github.com/expo/eas-cli/pull/684) by [@quinlanj](https://github.com/quinlanj))
- Enable no-underscore-dangle eslint rule. ([#686](https://github.com/expo/eas-cli/pull/686) by [@dsokal](https://github.com/dsokal))

## [0.31.1](https://github.com/expo/eas-cli/releases/tag/v0.31.1) - 2021-10-08

### 🐛 Bug fixes

- Google Service Account Keys: Fix non-interactive bug in credentials service workflow ([#682](https://github.com/expo/eas-cli/pull/682) by [@quinlanj](https://github.com/quinlanj))

## [0.31.0](https://github.com/expo/eas-cli/releases/tag/v0.31.0) - 2021-10-08

### 🛠 Breaking changes

- Don't resolve the iOS builder image on the client side. EAS Build will use the appropriate iOS image for a given Expo SDK version unless the `image` is defined. This only applies to managed projects. ([#675](https://github.com/expo/eas-cli/pull/675) by [@wkozyra95](https://github.com/wkozyra95), [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Integrate credentials service with Android submissions. ([#664](https://github.com/expo/eas-cli/pull/664) by [@quinlanj](https://github.com/quinlanj))
- Add option to review ad-hoc devices when reusing provisioning profile. ([#673](https://github.com/expo/eas-cli/pull/673) by [@dsokal](https://github.com/dsokal))

## [0.30.1](https://github.com/expo/eas-cli/releases/tag/v0.30.1) - 2021-10-06

### 🐛 Bug fixes

- Fix `--json` flag when running EAS CLI on GitHub actions. ([#669](https://github.com/expo/eas-cli/pull/669) by [@dsokal](https://github.com/dsokal))
- Fix `"ios: mods.ios.infoPlist: Failed to find Info.plist linked to Xcode project."` warning when running `eas build` in a managed project. ([#670](https://github.com/expo/eas-cli/pull/670) by [@brentvatne](https://github.com/brentvatne))
- Fix building monorepo projects on Windows. ([#671](https://github.com/expo/eas-cli/pull/671) by [@dsokal](https://github.com/dsokal))

## [0.30.0](https://github.com/expo/eas-cli/releases/tag/v0.30.0) - 2021-10-05

### 🛠 Breaking changes

- Enable auto-incrementing on Android. ([#645](https://github.com/expo/eas-cli/pull/645) by [@jkhales](https://github.com/jkhales))

### 🧹 Chores

- Ports detection for Google Service Account Keys into the credentials service. ([#660](https://github.com/expo/eas-cli/pull/660) by [@quinlanj](https://github.com/quinlanj))
- Improve iOS credentials printing. ([#657](https://github.com/expo/eas-cli/pull/657) by [@quinlanj](https://github.com/quinlanj))
- Automate `eas-cli` releases. ([#668](https://github.com/expo/eas-cli/pull/668) by [@dsokal](https://github.com/dsokal))

## [0.29.1](https://github.com/expo/eas-cli/releases/tag/v0.29.1) - 2021-09-29

### 🎉 New features

- More upload support for Google Service Account Keys. ([#649](https://github.com/expo/eas-cli/pull/649) by [@quinlanj](https://github.com/quinlanj))
- Allow the user to assign an existing Google Service Account Key to their project. ([#650](https://github.com/expo/eas-cli/pull/650) by [@quinlanj](https://github.com/quinlanj))
- Allow the user to remove a Google Service Account Key from their account. ([#658](https://github.com/expo/eas-cli/pull/658) by [@quinlanj](https://github.com/quinlanj))
- Adds setup support for Google Service Account Keys. ([#659](https://github.com/expo/eas-cli/pull/659) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Fix double prompt for Apple credentials when running `eas build --auto-submit`. ([#654](https://github.com/expo/eas-cli/pull/654) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Always use async `fs` functions. ([#652](https://github.com/expo/eas-cli/pull/652) by [@dsokal](https://github.com/dsokal))
- Improve Android credentials printing. ([#656](https://github.com/expo/eas-cli/pull/656) by [@quinlanj](https://github.com/quinlanj))

## [0.29.0](https://github.com/expo/eas-cli/releases/tag/v0.29.0) - 2021-09-28

### 🎉 New features

- Added upload support for Google Service Account Keys. ([#642](https://github.com/expo/eas-cli/pull/642) by [@quinlanj](https://github.com/quinlanj))
- Add Xcode 13 image. ([#651](https://github.com/expo/eas-cli/pull/651) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Credentials manager: stop prompting for an Android build profile every iteration. ([#641](https://github.com/expo/eas-cli/pull/641) by [@quinlanj](https://github.com/quinlanj))
- Don't display prompt in non-interactive mode when the metro config seems invalid. ([#644](https://github.com/expo/eas-cli/pull/644) by [@dsokal](https://github.com/dsokal))
- Read versions from correct `Info.plist`. ([#635](https://github.com/expo/eas-cli/pull/635) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Move away from weird convention of exports. ([#647](https://github.com/expo/eas-cli/pull/647) by [@quinlanj](https://github.com/quinlanj))

## [0.28.2](https://github.com/expo/eas-cli/releases/tag/v0.28.2) - 2021-09-23

### 🐛 Bug fixes

- Use `log-symbols` to unify green ticks style. ([#639](https://github.com/expo/eas-cli/pull/639) by [@dsokal](https://github.com/dsokal))
- Fix `eas build --auto-submit` in fresh projects. ([#640](https://github.com/expo/eas-cli/pull/640) by [@dsokal](https://github.com/dsokal))

## [0.28.1](https://github.com/expo/eas-cli/releases/tag/v0.28.1) - 2021-09-22

### 🐛 Bug fixes

- Prevent ora spinners breaking when debug logs are enabled. ([#575](https://github.com/expo/eas-cli/pull/575) by [@EvanBacon](https://github.com/EvanBacon))
- Do not fail `eas build` when transient network errors occur. ([#638](https://github.com/expo/eas-cli/pull/638) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Add GraphQL support for GoogleServiceAccountKey. ([#632](https://github.com/expo/eas-cli/pull/632) by [@quinlanj](https://github.com/quinlanj))
- Remove GraphQL support for the App Specific Password. ([#633](https://github.com/expo/eas-cli/pull/633) by [@quinlanj](https://github.com/quinlanj))

## [0.28.0](https://github.com/expo/eas-cli/releases/tag/v0.28.0) - 2021-09-20

### 🎉 New features

- Use envs from build profile to resolve app config when auto-submitting. ([#614](https://github.com/expo/eas-cli/pull/614) by [@dsokal](https://github.com/dsokal))
- Support multi flavor Android projects. ([#595](https://github.com/expo/eas-cli/pull/595) by [@wkozyra95](https://github.com/wkozyra95))
- Improve experience when using the build details page as a build artifact URL in `eas submit`. ([#620](https://github.com/expo/eas-cli/pull/620) by [@dsokal](https://github.com/dsokal))
- Better error message when eas.json is invalid JSON. ([#618](https://github.com/expo/eas-cli/pull/618) by [@dsokal](https://github.com/dsokal))
- Add warning about the legacy build service IDs in `eas submit`. ([#624](https://github.com/expo/eas-cli/pull/624) by [@dsokal](https://github.com/dsokal))
- Validate that project includes `expo-dev-client` when building with `developmentClient` flag. ([#627](https://github.com/expo/eas-cli/pull/627) by [@dsokal](https://github.com/dsokal))
- Better experience when not logged in in non-interactive mode. ([#628](https://github.com/expo/eas-cli/pull/628) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Reduce `eas-cli` size by almost getting rid of `lodash` from dependencies. ([#605](https://github.com/expo/eas-cli/pull/605) by [@dsokal](https://github.com/dsokal))
- Enforce explicit return type in all functions. ([#619](https://github.com/expo/eas-cli/pull/619) by [@wkozyra95](https://github.com/wkozyra95))
- Enforce `Async` suffix for async functions. ([#623](https://github.com/expo/eas-cli/pull/623) by [@dsokal](https://github.com/dsokal))

## [0.27.1](https://github.com/expo/eas-cli/releases/tag/v0.27.1) - 2021-09-10

### 🐛 Bug fixes

- Fixed force-creation, app secret creation, and secret deletion mutations. ([#606](https://github.com/expo/eas-cli/pull/606) by [@fiberjw](https://github.com/fiberjw))

## [0.27.0](https://github.com/expo/eas-cli/releases/tag/v0.27.0) - 2021-09-10

### 🎉 New features

- Implement support for `--platform all` in `eas submit`. ([#598](https://github.com/expo/eas-cli/pull/598) by [@dsokal](https://github.com/dsokal))
- Implement support for `--non-interactive` in `eas submit`. ([#600](https://github.com/expo/eas-cli/pull/600) by [@dsokal](https://github.com/dsokal))
- Add auto-submit feature. Run `eas build --auto-submit` to submit automatically on build complete. ([#603](https://github.com/expo/eas-cli/pull/603) by [@dsokal](https://github.com/dsokal))
- Allow using env var for `android.serviceAccountKeyPath` in submit profiles. ([#604](https://github.com/expo/eas-cli/pull/604) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix detecting `googleServicesFile` on Windows. ([#602](https://github.com/expo/eas-cli/pull/602) by [@wkozyra95](https://github.com/wkozyra95))

## [0.26.0](https://github.com/expo/eas-cli/releases/tag/v0.26.0) - 2021-09-08

### 🛠 Breaking changes

- Require `eas submit` to be configured with eas.json submit profiles (see [https://docs.expo.dev/submit/eas-json/](https://docs.expo.dev/submit/eas-json/) for details). Drop support for CLI params. ([#590](https://github.com/expo/eas-cli/pull/590) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Add `eas diagnostics` command. ([#594](https://github.com/expo/eas-cli/pull/594) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix `eas build` from throwing an exception when detecting the git `core.ignorecase` setting. ([#592](https://github.com/expo/eas-cli/pull/592) by [@mwillbanks](https://github.com/mwillbanks))
- Support app names that consist only of unicode characters. ([#596](https://github.com/expo/eas-cli/pull/596) by [@wkozyra95](https://github.com/wkozyra95))

## [0.25.0](https://github.com/expo/eas-cli/releases/tag/v0.25.0) - 2021-09-01

### 🛠 Breaking changes

- Drop support for node < 12. ([#581](https://github.com/expo/eas-cli/pull/581) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Support `--no-wait` in `eas submit`. ([#578](https://github.com/expo/eas-cli/pull/578) by [@dsokal](https://github.com/dsokal))
- Detect changes when `core.ignorecase` is set to true. ([#570](https://github.com/expo/eas-cli/pull/570) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix wrong warning for `metro.config.js` check on Windows. ([#588](https://github.com/expo/eas-cli/pull/588) by [@louisgv](https://github.com/louisgv))
- Fix detecting `googleServicesFile` with `EAS_NO_VCS=1`. ([#583](https://github.com/expo/eas-cli/pull/583) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Replace `@hapi/joi` with `joi`. Upgrade typescript to 4.4.2. Upgrade dependencies. ([#582](https://github.com/expo/eas-cli/pull/582) by [@dsokal](https://github.com/dsokal))
- Change typescript target from `ES2017` to `ES2019`. ([#584](https://github.com/expo/eas-cli/pull/584) by [@dsokal](https://github.com/dsokal))
- Use `ts-jest` instead of `babel-jest`. ([#585](https://github.com/expo/eas-cli/pull/585) by [@dsokal](https://github.com/dsokal))

## [0.24.1](https://github.com/expo/eas-cli/releases/tag/v0.24.1) - 2021-08-25

### 🐛 Bug fixes

- Fix wrong `EasJsonReader` import causing `eas submit` to fail. ([951ee](https://github.com/expo/eas-cli/commit/951eea2396591bd612aa7cb3038da35e45c33bb8) by [@dsokal](https://github.com/dsokal))

## [0.24.0](https://github.com/expo/eas-cli/releases/tag/v0.24.0) - 2021-08-25

### 🛠 Breaking changes

- Allow publishing of multiple update groups. ([#566](https://github.com/expo/eas-cli/pull/566) by [@jkhales](https://github.com/jkhales))

### 🎉 New features

- Retry status code 500-600 server errors from Apple servers with cookies auth. ([#574](https://github.com/expo/eas-cli/pull/574) by [@EvanBacon](https://github.com/EvanBacon))
- Throw internal server errors when Apple servers fail to authenticate. ([#574](https://github.com/expo/eas-cli/pull/574) by [@EvanBacon](https://github.com/EvanBacon))
- Add --auto flag for eas branch:publish. ([#549](https://github.com/expo/eas-cli/pull/549) by [@jkhales](https://github.com/jkhales))
- Add submissions link in output of `eas submit`. ([#553](https://github.com/expo/eas-cli/pull/553) by [@ajsmth](https://github.com/ajsmth))
- Add submit profiles. ([#555](https://github.com/expo/eas-cli/pull/555) by [@wkozyra95](https://github.com/wkozyra95))
- Add `changesNotSentForReview` option to android submissions. ([#560](https://github.com/expo/eas-cli/pull/560) by [@wkozyra95](https://github.com/wkozyra95))
- Support `--json` flag in build commands. ([#567](https://github.com/expo/eas-cli/pull/567) by [@wkozyra95](https://github.com/wkozyra95))
- Add link to https://expo.fyi/eas-build-archive in `eas build` output to make it easier to understand what is going on in the archive/upload phase of the build. ([#562](https://github.com/expo/eas-cli/pull/562) by [@brentvatne](https://github.com/brentvatne))
- Update QR code URL for Android internal distribution build and generate smaller QR code. ([#573](https://github.com/expo/eas-cli/pull/573) by [@axeldelafosse](https://github.com/axeldelafosse))

### 🐛 Bug fixes

- Fix `--sku` flag being ignored when running `eas submit -p ios`. ([#559](https://github.com/expo/eas-cli/pull/559) by [@barthap](https://github.com/barthap))
- Set correct distribution for simulator builds. ([#556](https://github.com/expo/eas-cli/pull/556) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Add warnings around common issues (`NODE_ENV=production`, git ignored `googleServicesFile`). ([#569](https://github.com/expo/eas-cli/pull/569) by [@wkozyra95](https://github.com/wkozyra95))

## [0.23.0](https://github.com/expo/eas-cli/releases/tag/v0.23.0) - 2021-08-05

### 🛠 Breaking changes

- Stop including deprecated storageBucket field when publishing. ([#547](https://github.com/expo/eas-cli/pull/547) by [@jkhales](https://github.com/jkhales))

### 🐛 Bug fixes

- Pass through metadata context to app version resolver. ([#550](https://github.com/expo/eas-cli/pull/550) by [@brentvatne](https://github.com/brentvatne))

## [0.22.4](https://github.com/expo/eas-cli/releases/tag/v0.22.4) - 2021-08-02

### 🐛 Bug fixes

- Fix build profile schema validation when `simulator` key is present for iOS. ([#546](https://github.com/expo/eas-cli/pull/546) by [@sallar](https://github.com/sallar))

## [0.22.2](https://github.com/expo/eas-cli/releases/tag/v0.22.2) - 2021-08-02

### 🛠 Breaking changes

- Introduce new format of eas.json (old eas.json will be migrated automatically). ([#537](https://github.com/expo/eas-cli/pull/537) by [@wkozyra95](https://github.com/wkozyra95))

### 🎉 New features

- Validate metro config for managed workflow projects. ([#534](https://github.com/expo/eas-cli/pull/534) by [@dsokal](https://github.com/dsokal))
- Add more filter params to `build:list`. ([#540](https://github.com/expo/eas-cli/pull/540) by [@dsokal](https://github.com/dsokal))
- Evaluate interpolated iOS version strings for metadata. ([#541](https://github.com/expo/eas-cli/pull/541) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Validate metadata client side to print better errors. ([#542](https://github.com/expo/eas-cli/pull/542) by [@wkozyra95](https://github.com/wkozyra95))
- Fix `new` build status when building both paltforms. ([#543](https://github.com/expo/eas-cli/pull/543) by [@wkozyra95](https://github.com/wkozyra95))
- Fix link to build details page where previously we used `project.name` instead of `project.slug` - leave out project segment entirely and depend on redirect. ([#554](https://github.com/expo/eas-cli/pull/554) by [@brentvatne](https://github.com/brentvatne))

## [0.22.1](https://github.com/expo/eas-cli/releases/tag/v0.22.1) - 2021-07-28

### 🎉 New features

- Include the file extension for update's assets in the manifest fragment. ([#535](https://github.com/expo/eas-cli/pull/535) by [@jkhales](https://github.com/jkhales))
- Use env variables from `eas.json` when evaluating `app.config.js`. ([#532](https://github.com/expo/eas-cli/pull/532) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix workflow detection when xcodeproj is an empty directory. ([#531](https://github.com/expo/eas-cli/pull/531) by [@wkozyra95](https://github.com/wkozyra95))
- Fix Android Keystore upload. ([#538](https://github.com/expo/eas-cli/pull/538) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Upgrade typescript to 4.3.5. ([#533](https://github.com/expo/eas-cli/pull/533) by [@dsokal](https://github.com/dsokal))

## [0.22.0](https://github.com/expo/eas-cli/releases/tag/v0.22.0) - 2021-07-23

### 🎉 New features

- Added support for automatically creating and linking iOS capability identifiers (Apple Pay, iCloud Containers, App Groups). ([#524](https://github.com/expo/eas-cli/pull/524) by [@EvanBacon](https://github.com/EvanBacon))
- Add `secret:create --force` command to overwrite existing secrets. ([#513](https://github.com/expo/eas-cli/pull/513) by [@bycedric](https://github.com/bycedric))
- Fall back to APK when building for internal distribution. ([#527](https://github.com/expo/eas-cli/pull/527) by [@dsokal](https://github.com/dsokal))
- Add `iosEnterpriseProvisioning` to build metadata. ([#522](https://github.com/expo/eas-cli/pull/522) by [@dsokal](https://github.com/dsokal))
- Autodetect Google Services JSON key path in `eas submit -p android`. ([#520](https://github.com/expo/eas-cli/pull/520) by [@barthap](https://github.com/barthap))

### 🐛 Bug fixes

- Fix iOS capability syncing on build. ([#521](https://github.com/expo/eas-cli/pull/521) by [@EvanBacon](https://github.com/EvanBacon))
- Fix unhandled error when amplitude domains are blocked. ([#512](https://github.com/expo/eas-cli/pull/512) by [@wkozyra95](https://github.com/wkozyra95))
- Use default value for `appBuildVersion` in build metadata when building an Android managed project. ([#526](https://github.com/expo/eas-cli/pull/526) by [@dsokal](https://github.com/dsokal))

## [0.21.0](https://github.com/expo/eas-cli/releases/tag/v0.21.0) - 2021-07-12

### 🎉 New features

- Add `project:*` commands. ([#500](https://github.com/expo/eas-cli/pull/500) by [@jkhales](https://github.com/jkhales))
- Added support for iOS 15 capabilities: Communication Notifications, Time Sensitive Notifications, Group Activities, and Family Controls. ([#499](https://github.com/expo/eas-cli/pull/499) by [@EvanBacon](https://github.com/EvanBacon))
- Show more build metadata in `build:view` and `build:list`. ([#504](https://github.com/expo/eas-cli/pull/504), [#508](https://github.com/expo/eas-cli/pull/508) by [@dsokal](https://github.com/dsokal))
- Add runtime version to build metadata. ([#493](https://github.com/expo/eas-cli/pull/493) by [@dsokal](https://github.com/dsokal))

## [0.20.0](https://github.com/expo/eas-cli/releases/tag/v0.20.0) - 2021-07-09

### 🛠 Breaking changes

- Unifify generic and managed workflow, deprecate `workflow` field. ([#497](https://github.com/expo/eas-cli/pull/497) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix runtime version checks. ([#495](https://github.com/expo/eas-cli/pull/495) by [@dsokal](https://github.com/dsokal))
- Resolve `--android-package` correctly in `eas submit` command. ([#494](https://github.com/expo/eas-cli/pull/494) by [@wkozyra95](https://github.com/wkozyra95))

## [0.19.1](https://github.com/expo/eas-cli/releases/tag/v0.19.1) - 2021-07-02

### 🎉 New features

- Improve project workflow detection (fixes the case where the `android` and/or `ios` directories are git-ignored). ([#490](https://github.com/expo/eas-cli/pull/490) by [@dsokal](https://github.com/dsokal))
- Improve credentials workflow with project creation and current working directories ([#491](https://github.com/expo/eas-cli/pull/491) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Better debugging experience ([#492](https://github.com/expo/eas-cli/pull/492) by [@quinlanj](https://github.com/quinlanj))

## [0.19.0](https://github.com/expo/eas-cli/releases/tag/v0.19.0) - 2021-07-01

### 🎉 New features

- Auto-suggest application id and bundle identifier when running `eas build:configure` for a managed project. ([#487](https://github.com/expo/eas-cli/pull/487) by [@dsokal](https://github.com/dsokal))
- Support configuring one platform at a time when running `eas build`. ([#483](https://github.com/expo/eas-cli/pull/483) by [@brentvatne](https://github.com/brentvatne))

## [0.18.3](https://github.com/expo/eas-cli/releases/tag/v0.18.3) - 2021-06-28

### 🎉 New features

- Support bundle identifiers that begin with `.`. ([#459](https://github.com/expo/eas-cli/pull/459) by [@EvanBacon](https://github.com/EvanBacon))
- Push Key setup integrated with ios build command ([#473](https://github.com/expo/eas-cli/pull/473) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Fix android builds for PKCS12 keystores. ([#484](https://github.com/expo/eas-cli/pull/484) by [@quinlanj](https://github.com/quinlanj))

## [0.18.2](https://github.com/expo/eas-cli/releases/tag/v0.18.2) - 2021-06-25

### 🎉 New features

- Change default iOS image for projects with Expo SDK <= 41 (SDK 41 won't build with Xcode 12.5). ([#479](https://github.com/expo/eas-cli/pull/479) by [@dsokal](https://github.com/dsokal))
- Make Apple team optional in appropriate cases. ([#468](https://github.com/expo/eas-cli/pull/468) by [@quinlanj](https://github.com/quinlanj))
- Show projects that depend on a push key. ([#472](https://github.com/expo/eas-cli/pull/472) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Fix inverted conditional so we actually only prompt about commit when index is dirty. ([#481](https://github.com/expo/eas-cli/pull/481) by [@brentvatne](https://github.com/brentvatne))

## [0.18.1](https://github.com/expo/eas-cli/releases/tag/v0.18.1) - 2021-06-24

### 🎉 New features

- Add basic printing support for Apple App Specific Password. ([#474](https://github.com/expo/eas-cli/pull/474) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Fix CLI UI getting blocked on credentials migration, leading to partially migrated state. ([#477](https://github.com/expo/eas-cli/pull/477) by [@brentvatne](https://github.com/brentvatne))

## [0.18.0](https://github.com/expo/eas-cli/releases/tag/v0.18.0) - 2021-06-24

### 🛠 Breaking changes

- Drop support for `experimental.npmToken` in credentials.json, EAS Secrets can be used instead. ([#444](https://github.com/expo/eas-cli/pull/444) by [@dsokal](https://github.com/dsokal))
- Remove `--allow-experimental` flag from `eas build:configure` as it has no effect now. ([#444](https://github.com/expo/eas-cli/pull/444) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Make credentials manager work with multi-target iOS projects. ([#441](https://github.com/expo/eas-cli/pull/441) by [@dsokal](https://github.com/dsokal))
- Copy over credentials from Expo Classic to EAS. ([#445](https://github.com/expo/eas-cli/pull/445) by [@quinlanj](https://github.com/quinlanj))
- Add Big Sur image for iOS builds. ([#457](https://github.com/expo/eas-cli/pull/457) by [@wkozyra95](https://github.com/wkozyra95))
- New version of Android credentials manager. ([#460](https://github.com/expo/eas-cli/pull/460) by [@quinlanj](https://github.com/quinlanj))
- Add an internal distribution with dev client to `build:configure` defaults. ([#465](https://github.com/expo/eas-cli/pull/465) by [@fson](https://github.com/fson))
- Add `updates.channel` to build metadata. ([#461](https://github.com/expo/eas-cli/pull/461) by [@jkhales](https://github.com/jkhales))
- iOS push key setup and management now available in `eas-cli credentials`. ([#469](https://github.com/expo/eas-cli/pull/469), [#470](https://github.com/expo/eas-cli/pull/470) by [@quinlanj](https://github.com/quinlanj))
- Support new build status: `new`. ([#475](https://github.com/expo/eas-cli/pull/475) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Deprecate `--skip-credentials-check` flag because it doesn't do anything and is no longer needed. ([#442](https://github.com/expo/eas-cli/pull/442) by [@brentvatne](https://github.com/brentvatne))
- Move android credentials code to new Graphql API. ([#439](https://github.com/expo/eas-cli/pull/439), [#440](https://github.com/expo/eas-cli/pull/440), [#438](https://github.com/expo/eas-cli/pull/438), [#443](https://github.com/expo/eas-cli/pull/443), [#447](https://github.com/expo/eas-cli/pull/447), [#451](https://github.com/expo/eas-cli/pull/451), [#455](https://github.com/expo/eas-cli/pull/455) by [@quinlanj](https://github.com/quinlanj))
- Prepare Graphql infra to support iOS push keys. ([#456](https://github.com/expo/eas-cli/pull/456) by [@quinlanj](https://github.com/quinlanj))
- Improve credentials DX ([#448](https://github.com/expo/eas-cli/pull/448), [#449](https://github.com/expo/eas-cli/pull/449) by [@quinlanj](https://github.com/quinlanj))
- Add analytics on dev client builds. ([#454](https://github.com/expo/eas-cli/pull/454) by [@fson](https://github.com/fson))
- Support non-git projects. ([#462](https://github.com/expo/eas-cli/pull/462) by [@wkozyra95](https://github.com/wkozyra95))

## [0.17.0](https://github.com/expo/eas-cli/releases/tag/v0.17.0) - 2021-06-02

### 🐛 Bug fixes

- Fix bundle identifier resolution when native target is not provided. ([#434](https://github.com/expo/eas-cli/pull/434) by [@dsokal](https://github.com/dsokal))
- Fix git repo root path getter on Windows. ([#429](https://github.com/expo/eas-cli/pull/429) by [@brentvatne](https://github.com/brentvatne))
- Fix resolving Android application identifier. ([#431](https://github.com/expo/eas-cli/pull/431) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Android credentials setup now on Graphql API. ([#427](https://github.com/expo/eas-cli/pull/427) by [@quinlanj](https://github.com/quinlanj))

## [0.16.0](https://github.com/expo/eas-cli/releases/tag/v0.16.0) - 2021-05-26

### 🎉 New features

- Opt out of capability syncing with `EXPO_NO_CAPABILITY_SYNC=1`. ([#426](https://github.com/expo/eas-cli/pull/426) by [@brentvatne](https://github.com/brentvatne))
- Add more verbose logging around capability syncing to help debug reported issues. ([#426](https://github.com/expo/eas-cli/pull/426) by [@brentvatne](https://github.com/brentvatne))
- Add managed credentials support for multi-target iOS projects. ([#414](https://github.com/expo/eas-cli/pull/414) by [@dsokal](https://github.com/dsokal))

## [0.15.1](https://github.com/expo/eas-cli/releases/tag/v0.15.1) - 2021-05-25

### 🎉 New features

- Support auto capabilities in managed workflow using Expo config plugin introspection. ([#419](https://github.com/expo/eas-cli/pull/419) by [@EvanBacon](https://github.com/EvanBacon))

### 🐛 Bug fixes

- Fix sending `appBuildVersion` as part of the build metadata. ([#423](https://github.com/expo/eas-cli/pull/423) by [@dsokal](https://github.com/dsokal))

## [0.15.0](https://github.com/expo/eas-cli/releases/tag/v0.15.0) - 2021-05-20

### 🛠 Breaking changes

- Remove "Auto" option for `schemeBuildConfiguration` and make the old "Auto" behaviour the default. ([#394](https://github.com/expo/eas-cli/pull/394) by [@randomhajile](https://github.com/randomhajile))
- Remove `experimental.disableIosBundleIdentifierValidation` flag from eas.json. ([#407](https://github.com/expo/eas-cli/pull/407) by [@dsokal](https://github.com/dsokal))
- Deprecate `android.package` and `ios.bundleIdentifier` in app config for generic projects. EAS CLI depends on the values in native code now. ([#407](https://github.com/expo/eas-cli/pull/407) by [@dsokal](https://github.com/dsokal))
- Remove application id synchronization (`android.package` and `ios.bundleIdentifier`) between app.json and native code when running builds. ([#407](https://github.com/expo/eas-cli/pull/407) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Auto sync associated domains capability before building. ([#384](https://github.com/expo/eas-cli/pull/384) by [@EvanBacon](https://github.com/EvanBacon))
- Add eas init command. ([#402](https://github.com/expo/eas-cli/pull/402) by [@jkhales](https://github.com/jkhales))
- Allow for arbitrary string values in `schemeBuildConfiguration`. ([#394](https://github.com/expo/eas-cli/pull/394) by [@randomhajile](https://github.com/randomhajile))
- Allow for installing custom `expo-cli` version on EAS Build. ([#409](https://github.com/expo/eas-cli/pull/409) by [@randomhajile](https://github.com/randomhajile))
- Support PKCS kesytores for Android. ([#398](https://github.com/expo/eas-cli/pull/398) by [@wkozyra95](https://github.com/wkozyra95))
- Support empty passwords in Android and iOS keystores. ([#398](https://github.com/expo/eas-cli/pull/398) by [@wkozyra95](https://github.com/wkozyra95))
- Add more build metadata - `appBuildVersion`. ([#413](https://github.com/expo/eas-cli/pull/413) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix failure when publishing without the platform flag. ([#415](https://github.com/expo/eas-cli/pull/415) by [@jkhales](https://github.com/jkhales))
- Pin versions in package.json. ([#399](https://github.com/expo/eas-cli/pull/399) by [@dsokal](https://github.com/dsokal))
  - Revert [0ac2f](https://github.com/expo/eas-cli/commit/0ac2fb77a118df609381c4e350aa68609340c3cd) as the root cause of the issue has been fixed in [#399](https://github.com/expo/eas-cli/pull/399).
- Include development-client in valid buildType for internal distribution. ([#410](https://github.com/expo/eas-cli/pull/410) by [@brentvatne](https://github.com/brentvatne))

## [0.14.1](https://github.com/expo/eas-cli/releases/tag/v0.14.1) - 2021-05-11

### 🐛 Bug fixes

- Make the default urql requestPolicy 'network-only'. ([#397](https://github.com/expo/eas-cli/pull/397) by [@jkhales](https://github.com/jkhales))

## [0.14.0](https://github.com/expo/eas-cli/releases/tag/v0.14.0) - 2021-05-10

### 🛠 Breaking changes

- Make eas branch:publish work with expo-cli >= 4.4.3 ([#366](https://github.com/expo/eas-cli/pull/366) by [@jkhales](https://github.com/jkhales))
- Create asset keys without an extension. ([#366](https://github.com/expo/eas-cli/pull/366) by [@jkhales](https://github.com/jkhales))

### 🎉 New features

- Display platforms supported by an update group ([#391](https://github.com/expo/eas-cli/pull/391) by [@jkhales](https://github.com/jkhales))
- Add a --platform flag to branch:publish command ([#389](https://github.com/expo/eas-cli/pull/389) by [@jkhales](https://github.com/jkhales))
- Release new credentials manager. ([#363](https://github.com/expo/eas-cli/pull/363) by [@quinlanj](https://github.com/quinlanj))
- Add QR code to install internal distribution build on device. ([#371](https://github.com/expo/eas-cli/pull/371) by [@axeldelafosse](https://github.com/axeldelafosse))

### 🧹 Chores

- Cleanup unused code. ([#364](https://github.com/expo/eas-cli/pull/364), [#365](https://github.com/expo/eas-cli/pull/365) by [@quinlanj](https://github.com/quinlanj))
- Redesign UX in beta credentials manager. ([#360](https://github.com/expo/eas-cli/pull/360) by [@quinlanj](https://github.com/quinlanj))
- Port more options to the beta credentials manager. ([#352](https://github.com/expo/eas-cli/pull/352), [#357](https://github.com/expo/eas-cli/pull/357), [#361](https://github.com/expo/eas-cli/pull/361) by [@quinlanj](https://github.com/quinlanj))
- Add getBuildProfileNamesAsync helper to EasJsonReader. ([#351](https://github.com/expo/eas-cli/pull/351) by [@quinlanj](https://github.com/quinlanj))
- Increase build timeout to 1 hour. ([#370](https://github.com/expo/eas-cli/pull/370) by [@wkozyra95](https://github.com/wkozyra95))
- Remove check for pending builds. ([#373](https://github.com/expo/eas-cli/pull/373) by [@wkozyra95](https://github.com/wkozyra95))

## [0.13.0](https://github.com/expo/eas-cli/releases/tag/v0.13.0) - 2021-04-22

### 🎉 New features

- Implement offline distribution certificate validation when running a build in non-interactive mode. ([#344](https://github.com/expo/eas-cli/pull/344) by [@dsokal](https://github.com/dsokal))
- Add support for building internal distribution apps for Apple Enterprise Teams. ([#344](https://github.com/expo/eas-cli/pull/344) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Display descriptive error message when API for EAS Build changes. ([#359](https://github.com/expo/eas-cli/pull/359) by [@wkozyra95](https://github.com/wkozyra95))

## [0.12.0](https://github.com/expo/eas-cli/releases/tag/v0.12.0) - 2021-04-22

### 🎉 New features

- Add the initiating user's username to the build metadata. ([#354](https://github.com/expo/eas-cli/pull/354) by [@dsokal](https://github.com/dsokal))
- Add `--clear-cache` flag for `eas build`. ([#355](https://github.com/expo/eas-cli/pull/355) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix the bug where the account name was used as the username. ([#354](https://github.com/expo/eas-cli/pull/354) by [@dsokal](https://github.com/dsokal))

## [0.11.1](https://github.com/expo/eas-cli/releases/tag/v0.11.1) - 2021-04-20

### 🎉 New features

- Resolve ios distribution types. ([#348](https://github.com/expo/eas-cli/pull/348) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Bump version of `@expo/apple-utils` to fix capabilities sync immediately after initial identifier registration. ([593c4](https://github.com/expo/eas-cli/commit/593c42f601396deba1751489343ec07b0a8876da) by [@brentvatne](https://github.com/brentvatne))

## [0.11.0](https://github.com/expo/eas-cli/releases/tag/v0.11.0) - 2021-04-20

### 🛠 Breaking changes

- `"credentialsSource": "auto"` is now deprecated. The option will use `"remote"` as the default value. ([#345](https://github.com/expo/eas-cli/pull/345) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Add validation when setting up ad-hoc provisioning profile in non-interactive mode. ([#338](https://github.com/expo/eas-cli/pull/338) by [@dsokal](https://github.com/dsokal))
- Allow for registering devices when running an ad-hoc build for the first time. ([#340](https://github.com/expo/eas-cli/pull/340) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix the bug where all Android managed builds produced AAB archives. The `buildType` property from `eas.json` is not ignored now. ([#349](https://github.com/expo/eas-cli/pull/349) by [@dsokal](https://github.com/dsokal))

## [0.10.0](https://github.com/expo/eas-cli/releases/tag/v0.10.0) - 2021-04-16

### 🛠 Breaking changes

- `secrets:<COMMAND>` is renamed to `secret:<COMMAND>` ([#315](https://github.com/expo/eas-cli/pull/315) by [@fiberjw](https://github.com/fiberjw))
- `secret:delete` now accepts `id` through a flag rather than an argument ([#315](https://github.com/expo/eas-cli/pull/315) by [@fiberjw](https://github.com/fiberjw))

### 🎉 New features

- Use special Expo SDK runtime version for managed projects ([#336](https://github.com/expo/eas-cli/pull/336) by [@wschurman](https://github.com/wschurman))

### 🐛 Bug fixes

- Fix the behavior where the provisioning profile was invalidated after syncing bundle id capabilities. ([#334](https://github.com/expo/eas-cli/pull/334) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Change build credentials summary format. ([#321](https://github.com/expo/eas-cli/pull/321) by [@dsokal](https://github.com/dsokal))

## [0.9.1](https://github.com/expo/eas-cli/releases/tag/v0.9.1) - 2021-04-09

### 🐛 Bug fixes

- Fix provisioning profile validation to actually check status. ([#318](https://github.com/expo/eas-cli/pull/318) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Replace Credentials REST API calls with GraphQL counterparts, also improved DX. ([#293](https://github.com/expo/eas-cli/pull/293), [#299](https://github.com/expo/eas-cli/pull/299), [#301](https://github.com/expo/eas-cli/pull/301), [#317](https://github.com/expo/eas-cli/pull/317) by [@quinlanj](https://github.com/quinlanj))

## [0.9.0](https://github.com/expo/eas-cli/releases/tag/v0.9.0) - 2021-04-09

### 🎉 New features

- Retry graphQL call on network or transient server errors. ([#320](https://github.com/expo/eas-cli/pull/320) by [@jkhales](https://github.com/jkhales))
- Display more friendly error messages when `eas submit` fails. ([#311](https://github.com/expo/eas-cli/pull/311) by [@barthap](https://github.com/barthap))
- Add support for managing webhooks (new commands: `webhook:create`, `webhook:view`, `webhook:list`, `webhook:update`, and `webhook:delete`). ([#314](https://github.com/expo/eas-cli/pull/314) by [@dsokal](https://github.com/dsokal))
- Support for local builds [experimental]. ([#305](https://github.com/expo/eas-cli/pull/305) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix the issue where the first iOS build fails for a project without `ios.bundleIdentifier` set in `app.json`. ([#319](https://github.com/expo/eas-cli/pull/319) by [@dsokal](https://github.com/dsokal))
- Bump @expo/config-plugins to fix `eas build:configure` on Windows. ([d0f3e](https://github.com/expo/eas-cli/commit/d0f3e387e7f31dbce4c3b93b8d083c7d20d9e30d) by [@brentvatne](https://github.com/brentvatne))
- Replace REST API calls with GraphQL counterparts. ([#333](https://github.com/expo/eas-cli/pull/333) by [@barthap](https://github.com/barthap))

## [0.8.1](https://github.com/expo/eas-cli/releases/tag/v0.8.1) - 2021-04-06

### 🐛 Bug fixes

- Fix the issue where the build status never got updated when running `eas build`. ([#310](https://github.com/expo/eas-cli/pull/310) by [@dsokal](https://github.com/dsokal))

## [0.8.0](https://github.com/expo/eas-cli/releases/tag/v0.8.0) - 2021-04-06

### 🛠 Breaking changes

- Change the way of disabling cache - add `cache.disabled` field. ([#295](https://github.com/expo/eas-cli/pull/295) by [@dsokal](https://github.com/dsokal))
- `secrets:create` now uses flags rather than positional arguments ([#300](https://github.com/expo/eas-cli/pull/300) by [@fiberjw](https://github.com/fiberjw))
- `secrets:create`'s `target` arg is now called `scope` ([#300](https://github.com/expo/eas-cli/pull/300) by [@fiberjw](https://github.com/fiberjw))
- `secrets:list`'s `target` property is now called `scope` ([#300](https://github.com/expo/eas-cli/pull/300) by [@fiberjw](https://github.com/fiberjw))
- `secrets:delete`'s `ID` arg is now optional ([#309](https://github.com/expo/eas-cli/pull/309) by [@fiberjw](https://github.com/fiberjw))
- `secrets:delete`'s now allows users to choose secrets from a list ([#309](https://github.com/expo/eas-cli/pull/309) by [@fiberjw](https://github.com/fiberjw))

### 🎉 New features

- `build:view` and `build:list` now showing the distribution type (store / internal) and release channel. ([#284](https://github.com/expo/eas-cli/pull/284) by [@vthibault](https://github.com/vthibault))
- Add analytics to EAS Build. ([#162](https://github.com/expo/eas-cli/pull/162) by [@wkozyra95](https://github.com/wkozyra95))
- Improve tar archive support in EAS Submit. ([#297](https://github.com/expo/eas-cli/pull/297) by [@barthap](https://github.com/barthap))

### 🐛 Bug fixes

- Fix environment secret creation prompt. ([#298](https://github.com/expo/eas-cli/pull/298) by [@fiberjw](https://github.com/fiberjw))

### 🧹 Chores

- Replace REST API calls with GraphQL counterparts. ([#286](https://github.com/expo/eas-cli/pull/286), [#288](https://github.com/expo/eas-cli/pull/288), [#303](https://github.com/expo/eas-cli/pull/303), [#306](https://github.com/expo/eas-cli/pull/306), [#307](https://github.com/expo/eas-cli/pull/307) by [@dsokal](https://github.com/dsokal))

## [0.7.0](https://github.com/expo/eas-cli/releases/tag/v0.7.0) - 2021-03-22

### 🎉 New features

- Print common error messages when builds fail. ([#272](https://github.com/expo/eas-cli/pull/272) by [@dsokal](https://github.com/dsokal))
- Commit automatically if `EAS_BUILD_AUTOCOMMIT` is set. ([#271](https://github.com/expo/eas-cli/pull/271) by [@wkozyra95](https://github.com/wkozyra95))
- Allow for installing custom `bundler` version on EAS Build. ([#277](https://github.com/expo/eas-cli/pull/277) by [@dsokal](https://github.com/dsokal))
- Add support for managing environment secrets. ([#275](https://github.com/expo/eas-cli/pull/275) by [@fiberjw](https://github.com/fiberjw))

### 🐛 Bug fixes

- Fix `eas submit` local archive prompt for `.aab` files when submitting for iOS. ([#273](https://github.com/expo/eas-cli/pull/273) by [@barthap](https://github.com/barthap))
- Verify whether "name" field in app.json contains any alphanumeric characters. ([#280](https://github.com/expo/eas-cli/pull/280) by [@wkozyra95](https://github.com/wkozyra95))
- Detect dependency cycles in eas.json build profiles. ([#283](https://github.com/expo/eas-cli/pull/283) by [@wkozyra95](https://github.com/wkozyra95))

## [0.6.0](https://github.com/expo/eas-cli/releases/tag/v0.6.0) - 2021-03-09

### 🛠 Breaking changes

- Generic iOS projects: build release builds by default. ([#266](https://github.com/expo/eas-cli/pull/266) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Log the size of the archived project when uploading. ([#264](https://github.com/expo/eas-cli/pull/264) by [@wkozyra95](https://github.com/wkozyra95))
- Add more build metadata (release channel, build profile name, git commit hash). ([#265](https://github.com/expo/eas-cli/pull/265) by [@dsokal](https://github.com/dsokal))
- Display App Store link after successful submission. ([#144](https://github.com/expo/eas-cli/pull/144) by [@barthap](https://github.com/barthap))
- Add `experimental.disableIosBundleIdentifierValidation` flag to eas.json. ([#263](https://github.com/expo/eas-cli/pull/263) by [@wkozyra95](https://github.com/wkozyra95))
- Support internal distribution in non-interactive builds. ([#269](https://github.com/expo/eas-cli/pull/269) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Print Apple Team ID in the output of `device:list` when the team name is unknown. ([#268](https://github.com/expo/eas-cli/pull/268) by [@wkozyra95](https://github.com/wkozyra95))

## [0.5.0](https://github.com/expo/eas-cli/releases/tag/v0.5.0) - 2021-03-02

### 🎉 New features

- Add support for build cache. ([#247](https://github.com/expo/eas-cli/pull/247) by [@wkozyra95](https://github.com/wkozyra95))
- Enable internal distribution support for self-managed credentials. ([#256](https://github.com/expo/eas-cli/pull/256) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Make sure all files are committed before build. ([#251](https://github.com/expo/eas-cli/pull/251) by [@wkozyra95](https://github.com/wkozyra95))
- Fix `eas submit` support for tar.gz files. ([#257](https://github.com/expo/eas-cli/pull/257) by [@wkozyra95](https://github.com/wkozyra95))
- Show untracked files when checking `git status`. ([#259](https://github.com/expo/eas-cli/pull/259) by [@wkozyra95](https://github.com/wkozyra95))

### 🧹 Chores

- Upgrade `@expo/eas-build-job` from `0.2.12` to `0.2.13`. ([#245](https://github.com/expo/eas-cli/pull/245) by [@dsokal](https://github.com/dsokal))

## [0.4.3](https://github.com/expo/eas-cli/releases/tag/v0.4.3) - 2021-02-23

### 🎉 New features

- Add support for iOS simulator builds. ([#240](https://github.com/expo/eas-cli/pull/240) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Use fixed version of `@expo/eas-json`. ([#243](https://github.com/expo/eas-cli/pull/243) by [@wkozyra95](https://github.com/wkozyra95))

## [0.4.2](https://github.com/expo/eas-cli/releases/tag/v0.4.2) - 2021-02-18

### 🐛 Bug fixes

- Fix detecting application target (iOS builds). ([#238](https://github.com/expo/eas-cli/pull/238) by [@dsokal](https://github.com/dsokal))

## [0.4.1](https://github.com/expo/eas-cli/releases/tag/v0.4.1) - 2021-02-16

### 🐛 Bug fixes

- Fix `"buildType" is not allowed` error. ([595bf](https://github.com/expo/eas-cli/commit/595bfecf1cbff0f76e7fd2049fe16f6f38bbe150) by [@wkozyra95](https://github.com/wkozyra95))

## [0.4.0](https://github.com/expo/eas-cli/releases/tag/v0.4.0) - 2021-02-16

### 🎉 New features

- Add build:cancel command. ([#219](https://github.com/expo/eas-cli/pull/219) by [@wkozyra95](https://github.com/wkozyra95))
- Implement version auto increment for iOS builds. ([#231](https://github.com/expo/eas-cli/pull/231) by [@dsokal](https://github.com/dsokal))
- Add support for builder environment customizations. ([#230](https://github.com/expo/eas-cli/pull/230) by [@wkozyra95](https://github.com/wkozyra95))
- Add `schemeBuildConfiguration` option for generic iOS builds. ([#234](https://github.com/expo/eas-cli/pull/234) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix `--no-wait` flag for `eas build`. ([#226](https://github.com/expo/eas-cli/pull/226) by [@paul-ridgway](https://github.com/paul-ridgway))
- Fix running builds from project subdirectories. ([#229](https://github.com/expo/eas-cli/pull/229) by [@wkozyra95](https://github.com/wkozyra95))
