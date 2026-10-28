---
'@expo/simulator-launcher': minor
---

Add `@expo/simulator-launcher` with commands for warm Simulators. `start` runs warmup at VM boot: it boots the device, tries to disable apsd, and starts one serve-sim with `--orphan`, Argent and agent-device. `claim` reserves the warm Simulator for one job without waiting for a tool. After serve-sim adoption selects the job's device, `prepare-tools` prepares the requested tool and tries to disable apsd on a device that missed warmup, without blocking app startup. `stop` ends warmup and waits for cleanup. This requires the matching serve-sim release and a fresh VM.
