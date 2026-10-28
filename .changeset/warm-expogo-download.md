---
'@expo/build-tools': minor
---

Let warm iOS sessions reuse the requested Expo Go version without downloading its archive. If the warm app does not match or the session falls back to cold startup, download and install the requested archive as usual. Deploy this consumer before workflows start passing the optional `expo_go` input.
