---
'@expo/build-tools': minor
---

Wait for confirmed warm Simulator cleanup before built-in iOS Simulator operations, and stop the job from using the Simulator if the cleanup fails. Worker setup can run while the cleanup finishes.

Let warm iOS sessions reuse a preinstalled Expo Go of the requested version without downloading its archive. If the warm app does not match, or the session uses a cold start, download and install the requested archive as usual. Deploy this consumer before workflows start passing the optional `expo_go` input.
