---
'eas-cli': patch
---

Quote `eas env:pull` values that `dotenv` would not read back verbatim, so values containing `#`, quotes, newlines or surrounding whitespace are no longer truncated or dropped.
