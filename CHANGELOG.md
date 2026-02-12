# Changelog

This is the log of notable changes to EAS CLI and related packages.

## main

### 🛠 Breaking changes

### 🎉 New features

- Auto-generate `ios.bundleIdentifier` and `android.package` in non-interactive mode when not set in app config. ([#3399](https://github.com/expo/eas-cli/pull/3399) by [@evanbacon](https://github.com/evanbacon))

### 🐛 Bug fixes

### 🧹 Chores

## [18.0.1](https://github.com/expo/eas-cli/releases/tag/v18.0.1) - 2026-02-12

### 🛠 Breaking changes

- Drop support for Node 18 and Node 19. Require Node 20+. ([#3343](https://github.com/expo/eas-cli/pull/3343) by [@sjchmiela](https://github.com/sjchmiela))

### 🎉 New features

- Add `--browser` flag to `eas login` for browser-based authentication. ([#3312](https://github.com/expo/eas-cli/pull/3312) by [@byronkarlen](https://github.com/byronkarlen))

### 🐛 Bug fixes

- Hide progress bar in build credits warning when usage reaches 100%. ([#3371](https://github.com/expo/eas-cli/pull/3371) by [@mackenco](https://github.com/mackenco))

### 🧹 Chores

- Upgrade `tar` to v7. ([#3327](https://github.com/expo/eas-cli/pull/3327) by [@KarolRzeminski](https://github.com/KarolRzeminski))

## [16.32.0](https://github.com/expo/eas-cli/releases/tag/v16.32.0) - 2026-01-30

### 🎉 New features

- Add `--browser` flag to `eas login` for browser-based authentication. ([#3312](https://github.com/expo/eas-cli/pull/3312) by [@byronkarlen](https://github.com/byronkarlen))
- List available options in non-interactive mode errors instead of generic "unable to select" messages, making CLI usable by agents and scripts. ([#3359](https://github.com/expo/eas-cli/pull/3359) by [@EvanBacon](https://github.com/EvanBacon))
- Hidden beta version of new `eas account:usage` command for viewing account usage and billing estimates. ([#3334](https://github.com/expo/eas-cli/pull/3334) by [@douglowder](https://github.com/douglowder), [@EvanBacon](https://github.com/EvanBacon))
- Add `--no-bytecode` and `--source-maps [mode]` flags to `eas update`. ([#3339](https://github.com/expo/eas-cli/pull/3339) by [@brentvatne](https://github.com/brentvatne))
- Add App Clip bundle identifier registration support for multi-target iOS builds. ([#3300](https://github.com/expo/eas-cli/pull/3300) by [@evanbacon](https://github.com/evanbacon))
- Warn in `eas build` when creating a production build from an app that uses Expo Go for development ([#3073](https://github.com/expo/eas-cli/pull/3073) by [@vonovak](https://github.com/vonovak))
- Add `--runtime-version` and `--platform` filters to `eas update:list`. ([#3261](https://github.com/expo/eas-cli/pull/3261) by [@HarelSultan](https://github.com/HarelSultan))

### 🐛 Bug fixes

- Fix `--source-maps` flag compatibility with older SDKs that only support it as a boolean flag. ([#3341](https://github.com/expo/eas-cli/pull/3341) by [@brentvatne](https://github.com/brentvatne))
- Use `--dump-sourcemaps` as fallback when `--source-maps` is not provided to `eas update`, for backwards compatibility. ([8cc324e1](https://github.com/expo/eas-cli/commit/8cc324e1) by [@brentvatne](https://github.com/brentvatne))
- Fix `metadata:pull` failing for apps with only a live version by falling back to live app version and info. ([#3299](https://github.com/expo/eas-cli/pull/3299) by [@EvanBacon](https://github.com/EvanBacon))
- eas init should fix and validate project name and slug. ([#3277](https://github.com/expo/eas-cli/pull/3277) by [@douglowder](https://github.com/douglowder))

### 🧹 Chores

- Test with node 24. ([#3270](https://github.com/expo/eas-cli/pull/3270) by [@wschurman](https://github.com/wschurman))
- Delete channel in background. ([#3278](https://github.com/expo/eas-cli/pull/3278) by [@quinlanj](https://github.com/quinlanj))
- Add warning to channel:delete. ([#3335](https://github.com/expo/eas-cli/pull/3335) by [@quinlanj](https://github.com/quinlanj))

## [16.28.0](https://github.com/expo/eas-cli/releases/tag/v16.28.0) - 2025-11-20

### 🎉 New features

- `eas:new` sorts organization accounts first in account selection. ([#3256](https://github.com/expo/eas-cli/pull/3256) by [@mackenco](https://github.com/mackenco))

### 🐛 Bug fixes

- Fix `eas:build` bug where overages are checked before config is ready. ([#3260](https://github.com/expo/eas-cli/pull/3260) by [@mackenco](https://github.com/mackenco))

### 🧹 Chores

- Delete branch in background. ([#3258](https://github.com/expo/eas-cli/pull/3258) by [@quinlanj](https://github.com/quinlanj))

## [16.27.0](https://github.com/expo/eas-cli/releases/tag/v16.27.0) - 2025-11-13

### 🎉 New features

- Kick off update patch generation if enabled - this is feature is in preview, don't use it for prod yet please. ([#3250](https://github.com/expo/eas-cli/pull/3250) by [@quinlanj](https://github.com/quinlanj))

### 🐛 Bug fixes

- Fix workflow:status when run ID passed in. ([#3253](https://github.com/expo/eas-cli/pull/3253) by [@douglowder](https://github.com/douglowder))
- Fix updating file env vars with `env:update --non-interactive`. ([#3249](https://github.com/expo/eas-cli/pull/3249) by [@kadikraman](https://github.com/kadikraman))

### 🧹 Chores

- Fix yarn watch. ([#3251](https://github.com/expo/eas-cli/pull/3251) by [@quinlanj](https://github.com/quinlanj))
- Remove the **node_modules** installation requirement for `workflow:run` command. ([#3254](https://github.com/expo/eas-cli/pull/3254) by [@kudo](https://github.com/kudo))

## [16.26.0](https://github.com/expo/eas-cli/releases/tag/v16.26.0) - 2025-10-29

### 🎉 New features

- New command `workflow:status`. ([#3242](https://github.com/expo/eas-cli/pull/3242) by [@douglowder](https://github.com/douglowder))
