# Changelog

This is the log of notable changes to EAS CLI and related packages.

## main

### 🛠 Breaking changes

- Require `eas submit` to be configured with eas.json submit profiles. Drop support for CLI params. ([#590](https://github.com/expo/eas-cli/pull/590) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

### 🐛 Bug fixes

### 🧹 Chores

## [0.25.0](https://github.com/expo/eas-cli/releases/tag/v0.25.0) - 2021-09-01

### 🛠 Breaking changes

- Drop support for node < 12. ([#581](https://github.com/expo/eas-cli/pull/581) by [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Support `--no-wait` in `eas submit`. ([#578](https://github.com/expo/eas-cli/pull/578) by [@dsokal](https://github.com/dsokal))
- Detect changes when `core.ignorecase` is set to true. ([#570](https://github.com/expo/eas-cli/pull/570) by [@wkozyra95](https://github.com/wkozyra95))

### 🐛 Bug fixes

- Fix wrong warning for `metro.config.js` check on Windows. ([#587](https://github.com/expo/eas-cli/pull/588) by [@louisgv](https://github.com/louisgv))
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

- Include the file extension for update's assets in the manifest fragment. ([#532](https://github.com/expo/eas-cli/pull/535) by [@jkhales](https://github.com/jkhales))
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
- Autodetect Google Services JSON key path in `eas submit -p android`. ([#520](https://github.com/expo/eas-cli/pull/297) by [@barthap](https://github.com/barthap))

### 🐛 Bug fixes

- Fix iOS capability syncing on build. ([#521](https://github.com/expo/eas-cli/pull/521) by [@EvanBacon](https://github.com/EvanBacon))
- Fix unhandled error when amplitude domains are blocked. ([#512](https://github.com/expo/eas-cli/pull/512) by [@wkozyra95](https://github.com/wkozyra95))
- Use default value for `appBuildVersion` in build metadata when building an Android managed project. ([#526](https://github.com/expo/eas-cli/pull/526) by [@dsokal](https://github.com/dsokal))

## [0.21.0](https://github.com/expo/eas-cli/releases/tag/v0.21.0) - 2021-07-12

### 🎉 New features

- Add `project:*` commands. ([#500](https://github.com/expo/eas-cli/pull/500) by [@jkhales](https://github.com/jkhales))
- Added support for iOS 15 capabilities: Communication Notifications, Time Sensitive Notifications, Group Activities, and Family Controls. ([#499](https://github.com/expo/eas-cli/pull/499) by [@EvanBacon](https://github.com/EvanBacon))
- Show more build metadata in `build:view` and `build:list`. ([#504](https://github.com/expo/eas-cli/pull/504) and [#508](https://github.com/expo/eas-cli/pull/508) by [@dsokal](https://github.com/dsokal))
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
- iOS push key setup and management now available in `eas-cli credentials`. ([#469](https://github.com/expo/eas-cli/pull/469) [#470](https://github.com/expo/eas-cli/pull/470) by [@quinlanj](https://github.com/quinlanj))
- Support new build status: `new`. ([#475](https://github.com/expo/eas-cli/pull/475) by [@dsokal](https://github.com/dsokal))

### 🧹 Chores

- Deprecate `--skip-credentials-check` flag because it doesn't do anything and is no longer needed. ([#442](https://github.com/expo/eas-cli/pull/442) by [@brentvatne](https://github.com/brentvatne))
- Move android credentials code to new Graphql API. ([#439](https://github.com/expo/eas-cli/pull/439) [#440](https://github.com/expo/eas-cli/pull/440) [#438](https://github.com/expo/eas-cli/pull/438) [#443](https://github.com/expo/eas-cli/pull/443) [#447](https://github.com/expo/eas-cli/pull/447) [#451](https://github.com/expo/eas-cli/pull/451) [#455](https://github.com/expo/eas-cli/pull/455) by [@quinlanj](https://github.com/quinlanj))
- Prepare Graphql infra to support iOS push keys. ([#456](https://github.com/expo/eas-cli/pull/456) by [@quinlanj](https://github.com/quinlanj))
- Improve credentials DX ([#448](https://github.com/expo/eas-cli/pull/448) [#449](https://github.com/expo/eas-cli/pull/449) by [@quinlanj](https://github.com/quinlanj))
- Add analytics on dev client builds. ([#454](https://github.com/expo/eas-cli/pull/454) by [@fson](https://github.com/fson))
- Support non-git projects. ([#462](https://github.com/expo/eas-cli/pull/462) by [@wkozyra95](https://github.com/wkozyra95))

## [0.17.0](https://github.com/expo/eas-cli/releases/tag/v0.17.0) - 2021-06-02

### 🐛 Bug fixes

- Fix bundle identifier resolution when native target is not provided. ([#434](https://github.com/expo/eas-cli/pull/434) by [@dsokal](https://github.com/dsokal))
- Fix git repo root path getter on Windows. ([#429](https://github.com/expo/eas-cli/pull/429) by [@brentvatne](https://github.com/brentvatne))
- Fix resolving Android application identifier. ([#431](https://github.com/expo/eas-cli/pull/431) by [@quinlanj](https://github.com/quinlanj))

### 🧹 Chores

- Android credentials setup now on Graphql API. ([#434](https://github.com/expo/eas-cli/pull/427) by [@quinlanj](https://github.com/quinlanj))

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
