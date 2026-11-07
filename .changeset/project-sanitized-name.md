---
'eas-cli': patch
---

Name the Xcode target of a managed iOS project with the project's own `@expo/config-plugins`, so an app name with accented letters (`Fotto Fotógrafos`) gets the same target name as SDK 58 prebuild instead of failing with "Could not find target".
