---
'@expo/build-tools': patch
---

Retry `eas/download_build` and `eas/download_artifact` downloads after a transfer failure or an HTTP 408, 429, 500, 502, 503 or 504 response, and keep the download URL out of their network error messages.
