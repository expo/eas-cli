# @expo/build-tools

`@expo/build-tools` is the core library for the EAS Build service. It implements the build process for React Native projects and for managed Expo applications.

## Device session hosts

[DeviceSessionHost](src/steps/utils/deviceSessionHost.ts) owns the local Device Hub server on Android and the serve-sim server on iOS. A web preview handle owns only its ngrok tunnel. Closing or replacing a preview does not stop the host or its recording.

Android recording is opt-in through `EAS_ANDROID_SESSION_RECORDING=1` and requires a Device Hub version with recording support. Capture starts with the host, even without a preview. The runner supplies the recording-control token automatically.

Callers await `host.finishAsync()` when the session ends, including error paths. It finalizes Android recording before stopping the host, then uploads the resulting files. Repeated calls share the same completion promise. Automation resources are cleaned up concurrently so recording upload does not delay their shutdown.

[Recording artifact validation and upload](src/steps/utils/deviceRunSessionScreenRecordings.ts) are shared with iOS. The existing iOS recording start and finish build steps remain independent of the session host.

## Repository

https://github.com/expo/eas-cli/tree/main/packages/build-tools
