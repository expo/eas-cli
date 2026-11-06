---
'@expo/build-tools': minor
---

Add the experimental `experimental_emulator_capture_version` input to `eas/start_android_emulator` and `eas/start_agent_device_session`. The Android Emulator then uses the lavapipe renderer and preloads that version of the `expo-emulator-capture` agent, and an expo-device-hub version with the emulator capture streams the screen from the agent. When the agent cannot install or load, expo-device-hub streams without it.
