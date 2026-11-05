---
'@expo/build-tools': patch
'@expo/worker': patch
---

Use the sandbox worker token for sandbox jobs when www provides one, and keep Expo credentials out of the commands of those jobs.
