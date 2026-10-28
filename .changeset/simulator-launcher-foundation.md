---
'@expo/simulator-launcher': minor
---

Add helpers for warm Simulator state, service readiness and process cleanup. Check the started serve-sim and Argent processes before reporting readiness, and wait for owned processes and output to close during cleanup.
