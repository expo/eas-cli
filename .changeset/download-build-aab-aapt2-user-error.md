---
'@expo/build-tools': patch
---

Preserve the original archive URL's file extension when redirects omit it in `eas/download_build`, and report invalid-APK `aapt2 dump badging` failures in `eas/install_build` as `EAS_INSTALL_BUILD_INVALID_ARTIFACT` user errors with truncated `aapt2` stderr details.
