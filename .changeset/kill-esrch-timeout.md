---
'@expo/build-tools': patch
---

Ignore processes that already exited when killing a timed-out `expo doctor`, install dependencies or install pods phase, instead of crashing the build with `ESRCH`.
