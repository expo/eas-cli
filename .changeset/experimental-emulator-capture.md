---
'@expo/build-tools': minor
---

Add the experimental `experimental_emulator_capture_version` input to `eas/start_android_emulator`. The Android Emulator then preloads that version of the `expo-emulator-capture` agent and uses the lavapipe renderer, and later steps start expo-device-hub with the emulator capture on. When the agent cannot install, the emulator starts as before.
