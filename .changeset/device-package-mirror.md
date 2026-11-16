---
'@expo/build-tools': patch
---

Start expo-device-hub and serve-sim in device sessions from the EAS package mirror in the `turtle-v2` bucket after a sha512 check, and fall back to npm with retries, so a new release that npm does not serve yet no longer fails new sessions.
