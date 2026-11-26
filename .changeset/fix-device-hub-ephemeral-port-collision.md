---
'@expo/build-tools': patch
---

Avoid ephemeral port collisions when launching `expo-device-hub`, `serve-sim`, and local egress servers by probing non-ephemeral local ports and retrying cold session host launches on port-in-use startup failures.
