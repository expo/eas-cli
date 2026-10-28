---
'@expo/build-tools': patch
'@expo/worker': patch
---

Put the `NPM_TOKEN` registry credential in the builder's npm user config on EAS Build (`~/.npmrc`, or the file `NPM_CONFIG_USERCONFIG` names), where pnpm 10.34.2+ and 11.5.3+ still expand `${NPM_TOKEN}` (they ignore it in a project-level `.npmrc`). Explain what to change when the project's pnpm version needs a newer Node.js than the build runs, including when eas.json sets `node` or `pnpm`.
