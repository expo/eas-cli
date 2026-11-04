---
'@expo/build-tools': patch
'eas-cli': patch
---

Record and upload Android emulator process output as a simulator session artifact by default. Add explicit source selection and a simulator CLI flag to opt in to recording and uploading device-wide logcat. Unselected sources are not recorded by simulator sessions.

Simulator sessions retain the first 20 MiB of each selected Android log source across launches and retries. The limit is enforced while recording; excess output is drained without saving, and artifacts remain uncompressed.
