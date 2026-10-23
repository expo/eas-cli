---
'@expo/build-tools': patch
---

Add internal helpers for claiming warm iOS Simulator services and validating the device returned by the controller. Start job video recording during adoption before app actions, and collect the server-owned recording without a separate recorder process.

Run warm Simulator APSd setup in the background and overlap tunnel opening with adoption. Drain setup before teardown, and keep the video-start acknowledgement before app actions.

Finish pending agent-device artifact uploads and check for final artifacts when a warm session stops.

Open the web preview tunnel while every session host starts, so `openPreviewAsync()` returns the startup tunnel.
