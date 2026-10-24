---
'@expo/build-tools': patch
---

Install `@expo/repack-app` for the `eas/repack` step with npm in a sandbox that sees only `PATH` and its own `HOME`, so the build machine's npm and Yarn configuration cannot break the install, fetch it through the EAS npm cache when the job uses one, and show the installer output in the build log. The step no longer looks the version up separately before installing. When the npm cache fails, the install retries against the public registry like the project install does; the `eas/run_agent` agent CLI install shares the same helper and gains the same retry.
