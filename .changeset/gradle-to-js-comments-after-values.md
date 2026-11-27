---
'eas-cli': patch
---

Read `applicationId`, `versionCode`, and `versionName` from `android/app/build.gradle` correctly in more cases, such as a comment or semicolon after the value, or no space in `android{`.
