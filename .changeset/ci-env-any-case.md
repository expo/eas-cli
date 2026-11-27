---
'eas-cli': patch
---

Treat `CI` set to `TRUE`, `yes` or any other non-empty value except `false`, `0`, `no` and `off` as CI instead of exiting with `GetEnv.NoBoolean`, as on Xcode Cloud.
