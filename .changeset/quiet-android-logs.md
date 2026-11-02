---
'@expo/build-tools': patch
'eas-cli': patch
---

Record and upload Android emulator process output as a simulator session artifact by default. Add explicit source selection and a simulator CLI flag to opt in to recording and uploading device-wide logcat. Unselected sources are not recorded by simulator sessions.

Compress diagnostic artifacts as complete gzip files after retaining at most the last 100 MiB of each raw log. Artifact metadata reports the original, retained, and compressed sizes and any truncation. Remove raw log files after successful upload.
