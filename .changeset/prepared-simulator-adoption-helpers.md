---
'@expo/build-tools': patch
---

Add internal helpers for claiming warm iOS Simulator services and validating the device returned by the controller. Start job video recording during adoption before app actions, and collect the server-owned recording without a separate recorder process.

Overlap tunnel opening with adoption, and keep the video-start acknowledgement before app actions. A warm Simulator arrives with apsd already disabled, so the job skips Simulator setup.

Finish pending agent-device artifact uploads and check for final artifacts when a warm session stops.

Open the web preview tunnel while every session host starts, so `openPreviewAsync()` returns the startup tunnel.

Skip installing Expo Go on a warm Simulator when the same Expo Go version is already installed.
