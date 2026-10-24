---
'@expo/build-tools': patch
---

Fail iOS submissions when App Store Connect build processing exceeds 30 minutes instead of reporting success. The build can still finish processing in App Store Connect after EAS stops waiting.
