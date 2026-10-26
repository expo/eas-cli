---
'@expo/worker': patch
'@expo/build-tools': patch
---

On images with the vm-tools startup script, stop warmup before job setup unless the gate enables a warm Simulator for the job (`EAS_USE_WARM_SIMULATOR=1`). The worker waits until the launcher confirms the cleanup. When such a job does not claim the warm Simulator, the launcher keeps it until the VM shuts down.
