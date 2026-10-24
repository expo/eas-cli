---
'eas-cli': patch
'@expo/build-tools': patch
'@expo/turtle-spawn': patch
---

Prevent stdin waits in Expo CLI config, prebuild, and export commands by closing stdin and preserving explicit stdio options when a logger is provided.
