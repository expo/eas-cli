---
'@expo/build-tools': patch
---

Validate Android `system_image_package` format and host architecture before calling `sdkmanager`, fail fast on deterministic `sdkmanager` package-not-found errors, and detect premature Android emulator exits during startup while surfacing the emulator output tail in error messages.
