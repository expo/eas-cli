---
'@expo/build-tools': patch
---

Stop waiting for a Datadog metric or log upload after 10 seconds, so a stalled upload cannot delay the job result.
