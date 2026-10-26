---
'@expo/simulator-launcher': minor
---

Add `@expo/simulator-launcher` for warm Simulators: `start` runs warmup at VM boot, `claim` hands the warm Simulator to a job, and `stop` ends warmup.

Warmup boots the device, disables apsd, preinstalls the latest stable Expo Go, starts serve-sim, and starts Argent and agent-device after serve-sim is ready. The warm Simulator is ready when the device has booted, the apsd disable attempt has finished and serve-sim answers.

A claim waits only for the requested engine and stops the other tools, also while they are still starting. The claim record names the preinstalled Expo Go, so the job can skip a matching install. A claim waits for an Expo Go install that already started and prevents a later one.

Replacement boots the requested device while the old tools and serve-sim stop. The old device shuts down in the background.

`stop` waits for every tool to stop and reports a cleanup failure instead of a confirmed stop. The launcher only checks for ffmpeg, which the VM image provides. Processes that exited but are not yet reaped count as stopped.

The launcher records its package version instead of copying its bundle. Build-tools uses that exact version for claim and stop.

Accept a comma-separated list of exact Simulator names or UDIDs for warmup.

Warm additional devices after the default is ready, each with its own serve-sim port.
