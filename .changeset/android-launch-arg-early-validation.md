---
'@expo/eas-build-job': minor
'@expo/build-tools': patch
---

Export `validateAndroidLaunchOptions` and `quoteAndroidShellCommand` from `@expo/eas-build-job`, so Android launch arguments can be checked for NUL characters and length before a simulator session starts, and check them before the emulator boots in agent-device sessions.
