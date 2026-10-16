---
'@expo/build-tools': minor
---

Pass the `cors_origins` session input to serve-sim and expo-device-hub as `--cors-origin` origins, so a third party page can call the preview host API, for example with `@expo/hub-client`.
