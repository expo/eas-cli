---
'eas-cli': patch
'eas-build-cache-provider': patch
---

Record a build uploaded to the build cache under the same development-client value its lookup searches by, so a locally built dev client is found again instead of missing the cache forever. Adds `--dev-client` / `--no-dev-client` to `eas upload`.
