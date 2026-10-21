---
'@expo/build-tools': patch
'@expo/worker': patch
---

Use a sandbox worker token for project setup, readiness, artifacts, and metrics without exposing Expo credentials to sandbox commands.
