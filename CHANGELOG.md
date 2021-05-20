# Changelog

This is the log of notable changes to EAS CLI and related packages.

## main

### 🛠 Breaking changes

- `[EAS BUILD API]` Remove "Auto" option for `schemeBuildConfiguration` and make the old "Auto" behaviour the default. ([#394](https://github.com/expo/eas-cli/pull/394) by [@randomhajile](https://github.com/randomhajile))
- Remove `experimental.disableIosBundleIdentifierValidation` flag from eas.json. ([#407](https://github.com/expo/eas-cli/pull/407) by [@dsokal](https://github.com/dsokal))
- Deprecate `android.package` and `ios.bundleIdentifier` in app config for generic projects. EAS CLI depends on the values in native code now. ([#407](https://github.com/expo/eas-cli/pull/407) by [@dsokal](https://github.com/dsokal))
- Remove application id synchronization (`android.package` and `ios.bundleIdentifier`) between app.json and native code when running builds. ([#407](https://github.com/expo/eas-cli/pull/407) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Auto sync associated domains capability before building. ([#384](https://github.com/expo/eas-cli/pull/384) by [@EvanBacon](https://github.com/EvanBacon))
- Add eas init command. [#402](https://github.com/expo/eas-cli/pull/402) by [@jkhales](https://github.com/jkhales))
- Allow for arbitrary string values in `schemeBuildConfiguration`. ([#394](https://github.com/expo/eas-cli/pull/394) by [@randomhajile](https://github.com/randomhajile))
- Allow for installing custom `expo-cli` version on EAS Build. ([#409](https://github.com/expo/eas-cli/pull/409) by [@randomhajile](https://github.com/randomhajile))
- Support PKCS kesytores for Android. ([#398](https://github.com/expo/eas-cli/pull/398) by [@wkozyra95](https://github.com/wkozyra95))
- Support empty passwords in Android and iOS keystores. ([#398](https://github.com/expo/eas-cli/pull/398) by [@wkozyra95](https://github.com/wkozyra95))
- Add more build metadata - `appBuildVersion`. ([#413](https://github.com/expo/eas-cli/pull/413) by [@dsokal](https://github.com/dsokal))

### 🐛 Bug fixes

- Fix failure when publishing without the platform flag.  ([#415](https://github.com/expo/eas-cli/pull/415) by [@jkhales](https://github.com/jkhales))
- Pin versions in package.json. ([#399](https://github.com/expo/eas-cli/pull/399) by [@dsokal](https://github.com/dsokal))
- Revert [0ac2f](https://github.com/expo/eas-cli/commit/0ac2fb77a118df609381c4e350aa68609340c3cd) as the root cause of the issue has been fixed in [#399](https://github.com/expo/eas-cli/pull/399).
- Include development-client in valid buildType for internal distribution. ([#410](https://github.com/expo/eas-cli/pull/410) by [@brentvatne](https://github.com/brentvatne))

### 🧹 Chores

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
- Port more options to the beta credentials manager. ([#352](https://github.com/expo/eas-cli/pull/352), [357](https://github.com/expo/eas-cli/pull/357), [361](https://github.com/expo/eas-cli/pull/361) by [@quinlanj](https://github.com/quinlanj))
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

- Use special Expo SDK runtime version for managed projects ([#336](https://github.com/expo/eas-cli/pull/336)) by [@wschurman](https://github.com/wschurman))

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
- Display more friendly error messages when `eas submit` fails. ([#311](https://github.com/expo/eas-cli/pull/297) by [@barthap](https://github.com/barthap))
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
