---
'eas-cli': patch
---

Print the notice about eas-cli in project dependencies only when stderr is a terminal, so programs that read stderr get the command's error.
