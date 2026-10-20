# @expo/build-tools

## 25.2.0

### Minor Changes

- Let serve-sim boot, install and launch agent-device iOS sessions with the local-egress guard. ([#4544](https://github.com/expo/eas-cli/pull/4544) by [@gwdp](https://github.com/gwdp))

## 25.1.1

### Patch Changes

- Call www only through the device run session worker API in device run session jobs, and remove their GraphQL fallbacks. ([#4638](https://github.com/expo/eas-cli/pull/4638) by [@szdziedzic](https://github.com/szdziedzic))

## 25.1.0

### Minor Changes

- Pass the `cors_origins` session input to serve-sim and expo-device-hub as `--cors-origin` origins, so a third party page can call the preview host API, for example with `@expo/hub-client`. ([#4657](https://github.com/expo/eas-cli/pull/4657) by [@krystofwoldrich](https://github.com/krystofwoldrich))
- Pass the `frame_ancestors` session input to serve-sim and expo-device-hub as `--frame-ancestor` origins, so a third party can embed the preview host. ([#4655](https://github.com/expo/eas-cli/pull/4655) by [@krystofwoldrich](https://github.com/krystofwoldrich))

### Patch Changes

- Allocate 4 GiB of guest RAM to Android emulators in EAS Simulator sessions. ([#4640](https://github.com/expo/eas-cli/pull/4640) by [@gwdp](https://github.com/gwdp))
- Retry transient Google Play API failures with exponential backoff while keeping uncertain commit results explicit. ([#4629](https://github.com/expo/eas-cli/pull/4629) by [@sjchmiela](https://github.com/sjchmiela))
- Retry Google Play edit commits when an uploaded Android App Bundle is still processing, with bounded retries and progress warnings. ([#4651](https://github.com/expo/eas-cli/pull/4651) by [@sjchmiela](https://github.com/sjchmiela))
- Report Google Play error responses to Sentry so unexplained submission failures can be classified. ([#4652](https://github.com/expo/eas-cli/pull/4652) by [@sjchmiela](https://github.com/sjchmiela))

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
