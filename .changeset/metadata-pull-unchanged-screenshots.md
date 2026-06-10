---
'eas-cli': patch
---

Fix `metadata:pull` rewriting unchanged screenshots on every pull. App Store Connect stamps a unique asset ID into each download's PNG metadata chunks; pulls now skip writing when the local file only differs in those volatile chunks.
