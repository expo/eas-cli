---
'@expo/simulator-launcher': minor
---

Add `@expo/simulator-launcher` for warm Simulators: `start` runs warmup at VM boot, `claim` hands the warm Simulator to a job, and `stop` ends warmup.

Warmup starts the first configured device, then warms the other devices after the first is ready and its tools and Expo Go preinstall finish. Each gets its own serve-sim port, apsd disable attempt and best-effort Expo Go preinstall. Agent-device and one Argent server prestart with the default device.

A claim waits only for the requested engine and stops the other tools, also while they are still starting. The claim record names the preinstalled Expo Go, so the job can skip a matching install. A claim waits for an Expo Go install that already started and prevents a later one.

A claim reuses a matching warm device and retires the others in the background. Replacement boots the requested device while all old tools and serve-sim processes stop; old devices shut down in the background.

`stop` waits for every tool to stop and reports a cleanup failure instead of a confirmed stop. The launcher only checks for ffmpeg, which the VM image provides. Processes that exited but are not yet reaped count as stopped.

The launcher records its package version instead of copying its bundle. Build-tools uses that exact version for claim and stop.
