---
'@expo/simulator-launcher': minor
---

Add start, stop and claim commands for warm Simulator sessions. Claiming reuses the warm device or replaces it with the requested device after cleanup.

Start unused-tool shutdown during claim without delaying handoff. Drain it during terminal cleanup; a shutdown failure prevents a stopped acknowledgement.

Preinstall the latest stable Expo Go during initial warmup without delaying the candidate. Claim prevents late warmup installs and waits for one already in progress before handing the device to the job.
