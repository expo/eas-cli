---
'@expo/simulator-launcher': minor
---

Add `simulator-launcher prefetch` to cache the selected Expo Go archive and reuse it during Simulator warmup. Use `EXPO_GO_SDK_VERSION` to select the SDK; ignore it when Expo Go preinstallation is disabled.

Honor an explicit Expo Go SDK during startup, reusing prepared archive metadata only when it matches.
