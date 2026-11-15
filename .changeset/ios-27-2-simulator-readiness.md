---
'@expo/build-tools': patch
---

Stop waiting for `com.apple.datamigrator` to exit before an iOS Simulator on iOS 27.2 or later counts as ready; there it stays resident, so the wait never finished. Earlier runtimes keep the wait. Take the readiness screenshot from the first integrated screen when the device lists several, so the iPhone Duo on iOS 27.2 passes the check.
