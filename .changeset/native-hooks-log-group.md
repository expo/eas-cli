---
'@expo/build-tools': patch
'@expo/steps': patch
---

Stop printing workflow hook parsing messages in build logs: native builds showed them under an "Unknown build phase" group, and custom builds warned about unknown hook keys and hooks on steps that never run.
