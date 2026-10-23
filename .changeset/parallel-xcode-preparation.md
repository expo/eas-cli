---
'@expo/worker': patch
---

Start the Xcode version check in the background during worker tool preparation. Apply the Xcode 26.0 upload workaround when the query finishes, without delaying job startup.
