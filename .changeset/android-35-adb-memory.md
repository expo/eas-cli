---
'@expo/build-tools': patch
---

Use 4 GiB of emulator RAM for Android 35 and 36 system images to reduce ADB disconnects during large transfers. Keep the RAM defaults for other images and preserve explicit emulator configuration overrides.
