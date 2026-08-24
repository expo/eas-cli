---
'eas-cli': patch
---

Honor the `--non-interactive` flag in `workflow:cancel`; it was parsed but never applied, so automation could hang on the interactive picker.
