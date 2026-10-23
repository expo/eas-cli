---
'eas-cli': patch
---

Preserve the input order of repeated simulator control arguments. Values after `--`, including `name=value`, are now positional literals; place named arguments before `--`.
