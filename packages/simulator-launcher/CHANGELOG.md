# @expo/simulator-launcher

## 27.2.0

### Minor Changes

- Accept a comma-separated list of warm Simulators in `EXPO_SIMULATOR_DEVICE`; the first is the default. One serve-sim serves every listed device on one port. After the default device is ready, warmup preinstalls the latest stable Expo Go from one download and tries to disable apsd on the other devices, until a job claims one. A claim can select any listed device and reports its preinstalled Expo Go. ([#4764](https://github.com/expo/eas-cli/pull/4764) by [@gwdp](https://github.com/gwdp))
- Add `@expo/simulator-launcher`, which warms an iOS Simulator at VM boot and hands it to one EAS job (`start`, `claim`, `prepare-tools`, `stop`). ([#4722](https://github.com/expo/eas-cli/pull/4722) by [@gwdp](https://github.com/gwdp))
