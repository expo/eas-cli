---
'@expo/build-tools': patch
---

Stop forcing the lavapipe renderer when starting Android emulators with experimental emulator capture. The emulator capture agent (expo-emulator-capture) chooses the GPU mode, so every user of the library gets the best performance out of the box.
