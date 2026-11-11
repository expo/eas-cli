---
'@expo/build-tools': patch
---

Point expo-device-hub at the scrcpy server copy in the `turtle-v2` bucket in Android device sessions, so a failed GitHub release download no longer fails the session. expo-device-hub falls back to GitHub when the copy is missing.
