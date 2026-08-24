---
'eas-cli': patch
---

Stop reporting a finish time for workflow runs that have not finished: `workflow:runs` reports `finishedAt` only for runs in a final status.
