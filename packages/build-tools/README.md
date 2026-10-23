# @expo/build-tools

`@expo/build-tools` is the core library for the EAS Build service. It implements the build process for React Native projects and for managed Expo applications.

## Repository

https://github.com/expo/eas-cli/tree/main/packages/build-tools

## Single-device previews

The `eas/start_serve_sim_remote_session`, `eas/start_agent_device_session`,
`eas/start_appium_remote_session`, and `eas/start_argent_remote_session` steps accept
an optional string input, `single_device`. Set it to the concrete iOS Simulator UDID
or Android adb serial to pass `--single-device <id>` to the preview host. If the step
also selects an iOS Simulator, the IDs must match. Build-tools checks serve-sim's
ready response against the pinned ID. Hub reports server readiness without a device ID.

Omitting the input keeps the existing behavior. Set it only with a serve-sim or
Device Hub package version that supports `--single-device`; publish that support
before enabling the input in generated jobs. This input locks the preview host;
it does not change the device selected by Appium, agent-device, or Argent.
