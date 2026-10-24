---
'@expo/build-tools': patch
---

Retry the build lookup and the archive download of `eas/download_build` on transient failures, and name the failure cause in the build log.
