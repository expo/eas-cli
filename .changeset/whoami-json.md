---
'eas-cli': minor
---

Add JSON output to `eas whoami` and `eas account:view`. A successful lookup reports the authenticated actor and their accounts. Signed-out sessions and rejected access tokens return distinct statuses and exit with code 1.

Lookup failures return an `indeterminate` status with the diagnostic on stderr.
