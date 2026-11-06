---
'eas-cli': patch
---

Stop suggesting other event names in `eas observe:events` when an event name with `--session-id`, `--app-version`, `--build-number`, or `--update-id` returns no events.
