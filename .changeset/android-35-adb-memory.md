---
'@expo/build-tools': patch
---

Default Android emulators to 4 GiB of RAM to reduce ADB disconnects during large transfers. Retain the 2 GiB default for API 34 and below outside interactive device sessions, and preserve explicit emulator configuration overrides.
