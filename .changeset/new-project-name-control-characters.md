---
'eas-cli': patch
---

Strip control characters from the `eas new` project name prompt, so clearing the prefilled name with Ctrl-U no longer creates a directory with an invisible `U+0015` prefix and fails with "Invalid slug".
