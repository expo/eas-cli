---
'@expo/build-tools': patch
---

Put the `NPM_TOKEN` registry credential in the builder's `~/.npmrc` on EAS Build, where pnpm 10.34.2+ and 11.5.3+ still expand `${NPM_TOKEN}` (they ignore it in a project-level `.npmrc`), and explain what to change when the project's pnpm version needs a newer Node.js than the build runs.
