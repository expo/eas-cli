---
'@expo/build-tools': patch
---

Use serve-sim's active display capture for iOS session thumbnails, fixing black thumbnails on multi-display Simulators. Thumbnails require a serve-sim version that supports background preview captures; older versions keep the session running without a thumbnail.
