# eas-cli pointer packages

This directory contains two internal npm packages:

- `eas-cli-for-eas-build` — pins the `eas-cli` version for EAS Build **production** infrastructure.
- `eas-cli-for-eas-build-staging` — pins the `eas-cli` version for EAS Build **staging** infrastructure.

Each package pins an exact `eas-cli` version in its `dependencies`. The `latest` version of each package is the pointer. The committed `version` and `eas-cli` dependency values are `0.0.0` placeholders. [`publish.mjs`](./publish.mjs) stamps the real values at publish time.

## Why these packages exist

EAS Build infrastructure needs a movable pointer to an exact `eas-cli` version. The pointer used to be the `latest-eas-build` and `latest-eas-build-staging` npm dist-tags on `eas-cli` (see `EasCliNpmTags` in `packages/eas-build-job/src/common.ts`).

npm [restricted sensitive operations for access tokens](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/) in August 2026. CI can no longer run `npm dist-tag add`. CI can still run `npm publish` with OIDC trusted publishing, and every publish moves the published package's `latest` tag. These packages rebuild the dist-tag mechanism on top of that one allowed operation.

## How the pointers move

- **On release** (`release.yml`): after `lerna publish`, CI publishes the staging pointer, runs the worker system tests, and then publishes the production pointer. A system-test failure stops the production pointer.
- **Manually** (`publish-eas-cli-pointer.yml` via _Actions → Publish eas-cli pointer packages → Run workflow_): pins any existing `eas-cli` version. Use this for promotion, rollback, or recovery. Inputs: `version` (exact `eas-cli` version), `target` (`staging`, `production`, or `both`), and `dry_run`.

To roll back, publish a pointer that pins the previous `eas-cli` version. Example: pin `21.5.0` again after a bad `21.5.1`.

Local fallback (requires npm account with publish access and 2FA):

```bash
node pointer-packages/publish.mjs --eas-cli-version 21.5.0 --target both --dry-run
```

Drop `--dry-run` to publish.

The script rewrites the `package.json` files in place, also in dry-run mode. Discard those changes after a local run. Keep the `0.0.0` placeholders committed.

## How the pointers are consumed

`resolveEasCommandPrefixAndEnvAsync()` in `packages/build-tools/src/utils/easCli.ts` will resolve the CLI through these packages instead of the old dist-tags (follow-up PR). Two equivalent consumption forms:

```bash
npx -y -p eas-cli-for-eas-build@latest eas <args>   # runs the pinned eas-cli bin directly
npx -y eas-cli-for-eas-build@latest <args>          # runs the package's forwarding bin
```

## One-time setup checklist (before the flows can run)

1. Confirm both package names are available on npm.
2. Publish both packages once manually (`npm publish` from each directory, with a 2FA-authenticated account), because the first publish of a new package may not be possible via trusted publishing.
3. On npmjs.com, configure a trusted publisher for **both** packages: repository `expo/eas-cli`, workflow `publish-eas-cli-pointer.yml`. If npm validates the caller workflow for reusable workflows, also add `release.yml`. Verify with a `dry_run: false` manual run pinning the current release.
4. Until `resolveEasCommandPrefixAndEnvAsync()` reads these packages and the worker fleet is redeployed, keep moving the old dist-tags manually after each release. The release flow posts a Slack reminder.
