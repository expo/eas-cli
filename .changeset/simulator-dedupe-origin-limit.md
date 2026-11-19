---
'eas-cli': patch
---

Count `--frame-ancestor` and `--cors-origin` values after dropping duplicates in `eas simulator`, so repeated origins no longer hit the 10-origin limit.
