---
'@expo/simulator-launcher': minor
---

Add start, stop and claim commands for warm Simulator sessions. A session is ready once its device boots and serve-sim answers. A claim waits only for its requested tool and stops the others, even mid-startup. Replacing the device boots the requested one while the old one is cleaned up.

Start unused-tool shutdown during claim without delaying handoff. Drain it during terminal cleanup; a shutdown failure prevents a stopped acknowledgement.

Preinstall the latest stable Expo Go during initial warmup without delaying the candidate. Claim prevents late warmup installs and waits for one already in progress before handing the device to the job.

Disable apsd on each warm device before reporting it ready.

Check for ffmpeg without installing it; the VM image provides it.
