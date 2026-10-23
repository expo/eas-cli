---
'eas-cli': patch
---

Require explicit `host:` simulator-host upload paths and report missing local files.

Missing local absolute paths now require the `host:` prefix. Actions that require upload IDs accept local files and reject host paths with an explanation.
