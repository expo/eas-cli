---
'eas-cli': minor
---

Add the hidden, experimental `--experimental-emulator-capture-version` flag to `eas simulator:start` for Android sessions. The emulator then preloads that version of `expo-emulator-capture`, and expo-device-hub streams the emulator screen from it when the expo-device-hub version supports the capture.
