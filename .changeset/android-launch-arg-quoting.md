---
'@expo/build-tools': patch
---

Quote Android launch arguments and URLs for the device shell in simulator sessions, so values with spaces or shell characters reach `am start` as one argument; pass raw values and remove any shell quoting added as a workaround.
