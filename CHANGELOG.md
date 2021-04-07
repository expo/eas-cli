# Changelog

This is the log of notable changes to EAS CLI and related packages.

## main

### 🛠 Breaking changes

### 🎉 New features

### 🐛 Bug fixes

### 🧹 Chores

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
- Fix `eas submit` support for tar.gz files. ([#257](https://github.com/expo/eas-cli/pull/257)) by [@wkozyra95](https://github.com/wkozyra95))
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

- Fix `"buildType" is not allowed` error. ([#595bf](https://github.com/expo/eas-cli/commit/595bfecf1cbff0f76e7fd2049fe16f6f38bbe150) by [@wkozyra95](https://github.com/wkozyra95))

## [0.4.0](https://github.com/expo/eas-cli/releases/tag/v0.4.0) - 2021-02-16

### 🎉 New features

- Add build:cancel command. ([#219](https://github.com/expo/eas-cli/pull/219) by [@wkozyra95](https://github.com/wkozyra95))
- Implement version auto increment for iOS builds. ([#231](https://github.com/expo/eas-cli/pull/231) by [@dsokal](https://github.com/dsokal))
- Add support for builder environment customizations. ([#230](https://github.com/expo/eas-cli/pull/230) by [@wkozyra95](https://github.com/wkozyra95))
- Add `schemeBuildConfiguration` option for generic iOS builds. ([#234](https://github.com/expo/eas-cli/pull/234) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix `--no-wait` flag for `eas build`. ([#226](https://github.com/expo/eas-cli/pull/226) by [@paul-ridgway](https://github.com/paul-ridgway))
- Fix running builds from project subdirectories. ([#229](https://github.com/expo/eas-cli/pull/229) by [@wkozyra95](https://github.com/wkozyra95))
