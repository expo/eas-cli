# @expo/build-tools

## 25.0.0

### Minor Changes

- Start `expo-device-hub` for Android simulator sessions with `--require-token` and the website origins, as serve-sim starts for iOS, and report its session token. ([#4578](https://github.com/expo/eas-cli/pull/4578) by [@krystofwoldrich](https://github.com/krystofwoldrich))
- Respect saved sharing preferences for iOS simulator preview sessions. ([#4620](https://github.com/expo/eas-cli/pull/4620) by [@gwdp](https://github.com/gwdp))
- Give agent-device and its simulator preview separate session logs. ([#4585](https://github.com/expo/eas-cli/pull/4585) by [@gwdp](https://github.com/gwdp))
- Give Appium and its simulator preview separate session logs. ([#4586](https://github.com/expo/eas-cli/pull/4586) by [@gwdp](https://github.com/gwdp))
- Give Argent and its simulator preview separate session logs. ([#4587](https://github.com/expo/eas-cli/pull/4587) by [@gwdp](https://github.com/gwdp))
- Let serve-sim start the iOS Simulator for web-preview sessions. ([#4601](https://github.com/expo/eas-cli/pull/4601) by [@gwdp](https://github.com/gwdp))
- Stream simulator preview output into its existing session step. ([#4525](https://github.com/expo/eas-cli/pull/4525) by [@gwdp](https://github.com/gwdp))

### Patch Changes

- Speed up cold iOS Appium sessions by launching preinstalled WebDriverAgent. ([#4618](https://github.com/expo/eas-cli/pull/4618) by [@gwdp](https://github.com/gwdp))
- Call the device run session worker API with the session token when www provides one. ([#4615](https://github.com/expo/eas-cli/pull/4615) by [@szdziedzic](https://github.com/szdziedzic))
- Clarify Google Play submission messages and reject zero Android submission rollouts. ([#4625](https://github.com/expo/eas-cli/pull/4625) by [@sjchmiela](https://github.com/sjchmiela))
