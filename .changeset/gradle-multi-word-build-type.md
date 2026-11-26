---
'eas-cli': patch
---

Parse a Gradle command whose build type has more than one word, such as `:app:assembleProdDebugOptimized`, as flavor `prod` and build type `debugOptimized` instead of flavor `prodDebug`, and don't warn about the `debugOptimized` build type.
