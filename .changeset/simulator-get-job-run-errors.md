---
'eas-cli': patch
---

Show why a simulator session failed in `eas simulator:get`, and add an `errors` array to its `--json` output. For an unknown error, `simulator:start` and `simulator:get` now show the failed step's error from the session logs.
