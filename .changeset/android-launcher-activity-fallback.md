---
'@expo/build-tools': patch
---

Fall back to resolving the Android launcher activity via Android's package manager (`adb shell cmd package resolve-activity`) when `aapt2 dump badging` omits `launchable-activity` or `eas/launch_application` is invoked without `activity_name`, and include `android.intent.action.MAIN` on default Android launcher starts.
