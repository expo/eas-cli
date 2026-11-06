---
'@expo/build-tools': minor
---

Add the experimental `experimental_emulator_capture_version` input to `eas/start_android_emulator` and `eas/start_agent_device_session`. The Android Emulator then preloads that version of the `expo-emulator-capture` agent, and expo-device-hub streams the emulator screen from the agent. When the agent cannot install or load, the session streams as before.
