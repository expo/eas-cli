---
'@expo/worker': patch
---

On images with the vm-tools startup script or current-boot launcher state, stop warmup before job setup unless the gate enables a warm Simulator for the job (`EAS_USE_WARM_SIMULATOR=1`). The worker waits until the launcher confirms the cleanup. When such a job does not claim the warm Simulator, the launcher keeps it until the VM shuts down.
