---
'@expo/build-tools': patch
---

Resolve the npm user config outside the project, so a `devEngines.packageManager` that is not npm no longer fails the build when `NPM_TOKEN` is set.
