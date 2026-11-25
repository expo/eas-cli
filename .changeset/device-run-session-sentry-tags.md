---
'@expo/build-tools': patch
'@expo/worker': patch
---

Tag the Sentry events of a device run session job with `deviceRunSessionId` and `jobRunId`, so an error in Sentry can be traced to one session.
