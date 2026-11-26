---
'@expo/build-tools': patch
---

Validate iOS Simulator UDIDs against available devices in `IosSimulatorUtils.resolveUdidAsync`, reporting nonexistent UDIDs as the user error `EAS_IOS_SIMULATOR_NOT_FOUND` instead of failing later during simulator boot.
