---
'eas-cli': patch
'@expo/build-tools': patch
'@expo/eas-build-job': patch
---

Fix sizes of 102.4 GB and larger being printed with a value about a million times too large, and share one `formatBytes` helper between `eas-cli` and `build-tools`.
