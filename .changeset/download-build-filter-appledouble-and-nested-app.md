---
'@expo/build-tools': patch
---

Skip macOS AppleDouble (`._*`) and `__MACOSX` entries when extracting build archives in `downloadBuildAsync`, ignore non-directory and nested `.app` entries during artifact selection, and sort matched artifacts deterministically by path depth and name.
