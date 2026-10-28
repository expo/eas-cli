# @expo/eas-build-job

## 27.0.0

No changes in this release.

## 26.0.0

### Major Changes

- Remove legacy artifact type exports and route workflow uploads through workflow storage without file-type categories. Preserve workflow uploads and Maestro reports. ([#4719](https://github.com/expo/eas-cli/pull/4719) by [@sjchmiela](https://github.com/sjchmiela))

### Minor Changes

- Export `validateAndroidLaunchOptions` and `quoteAndroidShellCommand` from `@expo/eas-build-job`, so Android launch arguments can be checked for NUL characters and length before a simulator session starts, and check them before the emulator boots in agent-device sessions. ([#4696](https://github.com/expo/eas-cli/pull/4696) by [@brentvatne](https://github.com/brentvatne))

## 25.3.0

No changes in this release.

## 25.2.0

No changes in this release.

## 25.1.1

No changes in this release.

## 25.1.0

No changes in this release.

## 25.0.0

No changes in this release.
