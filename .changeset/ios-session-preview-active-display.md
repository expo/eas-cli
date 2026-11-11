---
'@expo/build-tools': patch
---

Fix black iOS session preview artifacts on multi-display Simulators by capturing the active display through serve-sim.

Skip automatic previews on older serve-sim versions that cannot exclude them from idle activity.
