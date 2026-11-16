---
'@expo/build-tools': patch
'eas-cli': patch
---

Use serve-sim for standalone iOS Simulator startup and cloning, and remove build-tools' duplicate native guard; requires a compatible serve-sim release and one selected device per preview session.
