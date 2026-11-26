---
'@expo/build-tools': patch
---

Default `NODE_ENV` to `production` in the `eas/repack` step when the job does not set it, so a repacked release app no longer gets a development bundle that crashes on launch.
