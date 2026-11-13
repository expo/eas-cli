---
'@expo/build-tools': patch
---

Cancel the requests of a Datadog metric or log upload after 10 seconds, so a stalled upload cannot hold the job result.
