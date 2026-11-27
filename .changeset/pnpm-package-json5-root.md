---
'eas-cli': patch
---

Skip the `eas-cli` dependency notice check for a workspace root that has no `package.json`, such as a pnpm root that uses `package.json5`, instead of failing with `ENOENT`.
