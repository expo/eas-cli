---
'eas-cli': patch
---

Make `eas simulator:exec` fail when `.env.eas-simulator` has no ready session, instead of running the command against a local device.
