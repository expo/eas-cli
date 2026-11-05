---
'@expo/build-tools': patch
'eas-cli': patch
---

Record and upload Android emulator process output as a simulator session artifact by default. Add explicit source selection and a simulator CLI flag to opt in to recording and uploading device-wide logcat. Unselected sources are not recorded by simulator sessions.

Simulator sessions retain the last 20 MiB of each selected Android log source across launches and retries. Each log file is a fixed-size ring on disk, so the end of the final attempt is always kept; older output is dropped first, and artifacts remain uncompressed.
