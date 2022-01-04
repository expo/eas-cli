# Changelog

This is the log of notable changes to EAS CLI and related packages.

## main

### 🛠 Breaking changes

### 🎉 New features

- Add `eas device:delete`. ([#...](https://github.com/expo/eas-cli/pull/...) by [@kbrandwijk](https://github.com/kbrandwijk))

### 🐛 Bug fixes

### 🧹 Chores

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

- Adds commands for EAS Update, which is now in preview for subscribers. EAS Update makes fixing small bugs and pushing quick fixes a snap in between app store submissions. It accomplishes this by allowing an end-user's app to swap out the non-native parts of their app (for example, JS, styling, and image changes) with a new update that contains bug fixes and other updates.
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
- Fix building iOS projects with Apple Watch companion app. ([#812](https://github.com/expo/eas-cli/pull/812), [#817](https://github.com/expo/eas-cli/pull/817), [#821](https://github.com/expo/eas-cli/pull/821) by [@jkhales](https://github.com/jkhales) + [@dsokal](https://github.com/dsokal))

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

- Improve unknown capability syncing error message. ([#775](https://github.com/expo/eas-cli/pulls/775) by [@EvanBacon](https://github.com/EvanBacon))
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

- Use new build job format. ([#701](https://github.com/expo/eas-cli/pull/701) and [#711](https://github.com/expo/eas-cli/pull/711) by [@dsokal](https://github.com/dsokal))
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

- Make "production" the default profile for building and submitting. ([#677](https://github.com/expo/eas-cli/pull/677)) by [@jonsamp](https://github.com/jonsamp)
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

- Don't resolve the iOS builder image on the client side. EAS Build will use the appropriate iOS image for a given Expo SDK version unless the `image` is defined. This only applies to managed projects. ([#675](https://github.com/expo/eas-cli/pull/675) by [@wkozyra95](https://github.com/wkozyra95) + [@dsokal](https://github.com/dsokal))

### 🎉 New features

- Integrate credentials service with Android submissions. ([#664](https://github.com/expo/eas-cli/pull/664) by [@quinlanj](https://github.com/quinlanj))
- Add option to review ad-hoc devices when reusing provisioning profile. ([#673](https://github.com/expo/eas-cli/pull/673) by [@dsokal](https://github.com/dsokal))

## [0.30.1](https://github.com/expo/eas-cli/releases/tag/v0.30.1) - 2021-10-06

### 🐛 Bug fixes

- Fix `--json` flag when running EAS CLI on GitHub actions. ([#669](https://github.com/expo/eas-cli/pull/669) by [@dsokal](https://github.com/dsokal))
- Fix `"ios: mods.ios.infoPlist: Failed to find Info.plist linked to Xcode project."` warning when running `eas build` in a managed project.([#670](https://github.com/expo/eas-cli/pull/670) by [@brentvatne](https://github.com/brentvatne))
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

- Remove "Auto" option for `schemeBuildConfiguration` and make the old "Auto" behaviour the default. ([#394](https://github.com/expo/eas-cli/pull/394) by [@randomhajile](https://github.com/randomhajile))
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
