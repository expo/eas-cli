---
'@expo/build-tools': patch
---

Classify iOS Simulator incompatible architecture (`EAS_INSTALL_APPLICATION_INCOMPATIBLE_ARCH`), incompatible device family (`EAS_INSTALL_APPLICATION_INCOMPATIBLE_DEVICE_FAMILY`), and unregistered `open_url` scheme (`EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME`) `simctl` failures as user errors in both `serve-sim` actions and direct `install_build`/`launch_application` steps.
