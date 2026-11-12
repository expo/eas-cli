---
'@expo/build-tools': patch
---

Send an `Idempotency-Key` header when creating device run session and sandbox artifact upload sessions, reuse it when an upload is retried, and stop retrying an upload that www rejects.
