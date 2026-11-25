---
'@expo/build-tools': patch
---

Retry the cache archive download after a transfer failure or an HTTP 408, 429, 500, 502, 503 or 504 response, and keep the signed URL out of its network error messages.
