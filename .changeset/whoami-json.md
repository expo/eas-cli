---
'eas-cli': minor
---

Add `--json` to `eas whoami` and `eas account:view`. Both accept `--non-interactive`. Unknown flags and extra positional arguments now exit with code 1.

A successful response has status `signed-in` and exit code 0. Use `actor.id` to identify the actor and `actor.displayName` for display, including robot labels. `actor.type` currently reports `User`, `SSOUser`, `Robot`, or `PartnerActor`. Consumers should allow future actor types. `accounts` lists membership names.

The remaining statuses exit with code 1. `signed-out` means there is no signed-in session. `token-rejected` means the API explicitly rejected the bearer credential. `indeterminate` means identity could not be verified, including network errors, permission failures, or a bearer lookup that returned no actor. The diagnostic goes to stderr.
