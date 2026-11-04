---
'eas-cli': patch
---

Escape Apple credentials before scrubbing them from `eas metadata` telemetry, so a value containing `+`, `.` or `(` is redacted instead of being sent verbatim or throwing.
