---
'eas-cli': patch
'@expo/build-tools': patch
'@expo/eas-build-job': patch
---

Share one `formatBytes` helper between `eas-cli` and `build-tools`, which also fixes `eas-cli` sizes of 102.4 GB and larger.
