---
'@expo/simulator-launcher': patch
---

Attempt to disable apsd after adopting a Simulator that missed warmup setup. Keep the attempt nonblocking for app startup, and drain it before shutting down the device.
