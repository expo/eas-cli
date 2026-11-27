---
'@expo/worker': patch
---

Skip the project dependencies report for build jobs that carry `builder`, because a native project has no `package.json`.
