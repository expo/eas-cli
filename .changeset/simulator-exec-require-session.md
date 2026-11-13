---
'eas-cli': patch
---

Make `eas simulator:exec` fail when `.env.eas-simulator` has no session or no agent-device connection, instead of running the command against a local device, and print the full path of `.env.eas-simulator` in `eas simulator:start`.
