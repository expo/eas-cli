---
'@expo/worker': patch
'@expo/build-tools': patch
---

Stop warmup in the background for jobs that do not use the warm Simulator, so job setup does not wait for it. Before build-tools boots or clones a Simulator, it waits until the launcher's state file records that cleanup finished, and fails if cleanup does not finish in time.
