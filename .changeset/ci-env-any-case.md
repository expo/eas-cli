---
'eas-cli': patch
---

Treat `CI` set to `TRUE`, `yes` or any other non-empty value except `false` and `0` as CI instead of exiting with `GetEnv.NoBoolean`, as on Xcode Cloud.
