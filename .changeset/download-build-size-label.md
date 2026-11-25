---
'@expo/build-tools': patch
---

Remove the redundant `bytes` suffix from the archive size in the `eas/download_build` log, so it reads `128 MB` instead of `128 MB bytes`.
