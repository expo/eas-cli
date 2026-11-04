---
'eas-cli': patch
---

Fail `eas deploy --prod` and `eas deploy:alias` when the alias was not moved to the new deployment, instead of reporting success and exiting 0.
