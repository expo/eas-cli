---
'@expo/build-tools': patch
---

Remote device run sessions now end the running apps on the Simulator or emulator when the session stops, so a dev server reached through a tunnel drops the app's debugger page instead of listing it until the dev server restarts.
