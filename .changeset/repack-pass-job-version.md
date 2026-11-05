---
'@expo/build-tools': patch
---

Pass the build number and app version that EAS assigned to the job to `@expo/repack-app` in `eas/repack`, so that a repacked app can carry the build number that EAS records.
