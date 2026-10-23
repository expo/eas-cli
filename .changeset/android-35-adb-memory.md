---
'@expo/build-tools': patch
---

Use 4 GiB of emulator RAM for the Android 35 Google APIs x86_64 system image to reduce ADB disconnects during large transfers. Keep the RAM defaults for other images and preserve explicit emulator configuration overrides.
