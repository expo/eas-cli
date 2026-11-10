# @expo/simulator-launcher

## 27.7.0

No changes in this release.

## 27.6.0

### Minor Changes

- Prepare pinned Appium, XCUITest and WebDriverAgent files with `prefetch`. ([#4836](https://github.com/expo/eas-cli/pull/4836) by [@gwdp](https://github.com/gwdp))
- Add `simulator-launcher prefetch` to cache Expo Go downloads. ([#4834](https://github.com/expo/eas-cli/pull/4834) by [@gwdp](https://github.com/gwdp))
- Use caller-supplied serve-sim, agent-device and Argent versions and include exact version inputs in claims. ([#4845](https://github.com/expo/eas-cli/pull/4845) by [@gwdp](https://github.com/gwdp))
- Add `simulator-launcher warmup` so consumers can warm up Simulators, install Expo Go and prepare native tool caches. The command stops its tools and shuts down the selected Simulators before returning. ([#4838](https://github.com/expo/eas-cli/pull/4838) by [@gwdp](https://github.com/gwdp))

## 27.5.0

No changes in this release.

## 27.4.1

### Patch Changes

- Wait for a starting warm Simulator launcher before claiming its session, instead of falling back to a cold start. ([#4810](https://github.com/expo/eas-cli/pull/4810) by [@gwdp](https://github.com/gwdp))

## 27.4.0

### Minor Changes

- Add `eas/start_warm_appium_remote_session`, which runs the Appium session on the warm Simulator, or starts cold. An `appium` claim stops the unused tools first, so WDA does not share the Simulator with the agent-device runner. ([#4735](https://github.com/expo/eas-cli/pull/4735) by [@gwdp](https://github.com/gwdp))

## 27.3.0

No changes in this release.

## 27.2.0

### Minor Changes

- Accept a comma-separated list of warm Simulators in `EXPO_SIMULATOR_DEVICE`; the first is the default. One serve-sim serves every listed device on one port. After the default device is ready, warmup preinstalls the latest stable Expo Go from one download and tries to disable apsd on the other devices, until a job claims one. A claim can select any listed device and reports its preinstalled Expo Go. ([#4764](https://github.com/expo/eas-cli/pull/4764) by [@gwdp](https://github.com/gwdp))
- Add `@expo/simulator-launcher`, which warms an iOS Simulator at VM boot and hands it to one EAS job (`start`, `claim`, `prepare-tools`, `stop`). ([#4722](https://github.com/expo/eas-cli/pull/4722) by [@gwdp](https://github.com/gwdp))
