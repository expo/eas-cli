---
'@expo/build-tools': minor
---

Let worker setup run while warm Simulator cleanup finishes, then wait for confirmed cleanup before built-in iOS Simulator operations. If cleanup fails, prevent the job from using the Simulator.
