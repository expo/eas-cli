---
'eas-cli': patch
---

Make `eas simulator:exec` fail, instead of running the command against a local device, when `.env.eas-simulator` has no session or the session is still starting; sessions started with `--out-config-type env` write no file, so run their commands without `eas simulator:exec`. Print the full path of `.env.eas-simulator` in `eas simulator:start`.
