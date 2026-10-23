---
'eas-cli': patch
---

Read the app config fewer times in `eas build` and other project commands. An iOS build now runs `expo config` 2 times instead of 6.
