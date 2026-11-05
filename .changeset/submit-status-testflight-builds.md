---
'eas-cli': patch
---

Fetch the latest TestFlight builds in `eas submit:status` with far fewer App Store Connect requests. On an app with about 15,000 builds it now makes 75 requests instead of about 2,900.
