---
'@expo/build-tools': patch
---

Report an iOS Simulator app install that fails with "Requires a Newer Version of iOS" as the user error `EAS_INSTALL_APPLICATION_REQUIRES_NEWER_IOS`, with a message that asks for a Simulator device whose iOS version meets the app's minimum, or a lower iOS deployment target. Other install failures still report `SERVER_ERROR`.
