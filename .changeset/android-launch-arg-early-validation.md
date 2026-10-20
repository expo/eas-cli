---
'@expo/build-tools': patch
---

Check Android launch arguments for NUL characters and length before the emulator boots in agent-device simulator sessions, so invalid input fails right away instead of after the build installs.
