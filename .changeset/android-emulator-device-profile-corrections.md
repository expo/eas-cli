---
'@expo/build-tools': patch
---

Make the Pixel 9 Android emulator match the real device: after boot, install overlays with the real status bar height, display cutout area, and status bar spacing. Images without root, such as Google Play images, skip it. Set `ANDROID_EMULATOR_APPLY_DEVICE_PROFILE_CORRECTIONS=false` to skip it.
