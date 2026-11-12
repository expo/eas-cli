# eas-cli

## 27.9.0

### Minor Changes

- Warn about Expo Simulators and EAS Workflows outages from status.expo.dev before `eas simulator:start` creates a session, and describe degraded performance and maintenance correctly in all outage warnings. ([#4873](https://github.com/expo/eas-cli/pull/4873) by [@szdziedzic](https://github.com/szdziedzic))

## 27.8.0

### Minor Changes

- Tell accounts without EAS Simulator access that it is available on the Starter, Production, and Enterprise plans and link to the billing page, instead of pointing at the waitlist. `simulator:availability --json` now returns `billingUrl` instead of `waitlistUrl`. ([#4866](https://github.com/expo/eas-cli/pull/4866) by [@szdziedzic](https://github.com/szdziedzic))

### Patch Changes

- Remove the "Android emulator support is still in development" warning from `eas simulator`. ([#4870](https://github.com/expo/eas-cli/pull/4870) by [@szdziedzic](https://github.com/szdziedzic))
- Fix sizes of 102.4 GB and larger being printed with a value about a million times too large, and share one `formatBytes` helper between `eas-cli` and `build-tools`. ([#4854](https://github.com/expo/eas-cli/pull/4854) by [@vonovak](https://github.com/vonovak))
- Package local Simulator app bundles for upload when the host supports gzip tar archives, and reject unsupported IPA and ZIP installs before uploading. ([#4684](https://github.com/expo/eas-cli/pull/4684) by [@gwdp](https://github.com/gwdp))

  Fix packaging stalls for app bundles containing hard links and clean temporary archives when interrupted. Local app directories and `.tar.gz`/`.tgz` files require a host advertising archive support.

- Remove the `[EXPERIMENTAL]` label from `eas simulator` commands, except `eas simulator:egress` and the `--egress` flag. ([#4869](https://github.com/expo/eas-cli/pull/4869) by [@szdziedzic](https://github.com/szdziedzic))

## 27.7.2

### Patch Changes

- Add `--log-source` to `eas simulator` to select which Android logs a session records. ([#4823](https://github.com/expo/eas-cli/pull/4823) by [@vonovak](https://github.com/vonovak))
- Show that the ssh session has ended, instead of saying SSH was not enabled, when `eas workflow:ssh` is given the ID of a finished build. ([#4842](https://github.com/expo/eas-cli/pull/4842) by [@AHGIJMKLKKZNPJKQR](https://github.com/AHGIJMKLKKZNPJKQR))
- Show the ID argument and examples in `eas workflow:ssh --help`. ([#4829](https://github.com/expo/eas-cli/pull/4829) by [@AHGIJMKLKKZNPJKQR](https://github.com/AHGIJMKLKKZNPJKQR))

## 27.7.1

### Patch Changes

- Update `node-forge`, `tar`, `nanoid`, `minimatch`, `joi`, `ajv`, `yaml`, and `zod` to versions with fixes for published security advisories. ([#4847](https://github.com/expo/eas-cli/pull/4847) by [@tchayen](https://github.com/tchayen))

## 27.7.0

### Minor Changes

- Add `--git-branch` and `--git-commit-hash` to `eas workflow:run` to record the branch and commit of the uploaded project. ([#4815](https://github.com/expo/eas-cli/pull/4815) by [@hSATAC](https://github.com/hSATAC))

### Patch Changes

- Stop spinners from flickering when their text wraps onto a second line, such as the `simulator:start` queue message in a narrow terminal. ([#4850](https://github.com/expo/eas-cli/pull/4850) by [@brentvatne](https://github.com/brentvatne))

## 27.6.0

### Minor Changes

- Add the `--property key=value` flag to `eas observe:events` to filter events by a property value. ([#4812](https://github.com/expo/eas-cli/pull/4812) by [@Ubax](https://github.com/Ubax))

### Patch Changes

- Stop suggesting other event names in `eas observe:events` when an event name with `--session-id`, `--app-version`, `--build-number`, or `--update-id` returns no events. ([#4813](https://github.com/expo/eas-cli/pull/4813) by [@Ubax](https://github.com/Ubax))

## 27.5.0

### Minor Changes

- Import ordered action configurations with `eas simulator:control --import` and show progress for each action. ([#4686](https://github.com/expo/eas-cli/pull/4686) by [@gwdp](https://github.com/gwdp))
- Reuse simulator control connections with `--keep-alive` or `simulator:control:connection open`. Set an idle timeout, inspect the connection, or close it without stopping the simulator session. Keep-alive currently supports macOS and Linux. ([#4791](https://github.com/expo/eas-cli/pull/4791) by [@gwdp](https://github.com/gwdp))
- Start simulator sessions from saved settings and apply control actions after readiness. ([#4687](https://github.com/expo/eas-cli/pull/4687) by [@gwdp](https://github.com/gwdp))
- Run `eas simulator` commands also as `eas simulators`, `eas emulator` and `eas emulators`, for example `eas emulators:start` or `eas simulators:list`. These aliases are hidden from help. ([#4794](https://github.com/expo/eas-cli/pull/4794) by [@szdziedzic](https://github.com/szdziedzic))
- List `eas workflow:ssh` in `eas --help`. ([#4793](https://github.com/expo/eas-cli/pull/4793) by [@AHGIJMKLKKZNPJKQR](https://github.com/AHGIJMKLKKZNPJKQR))

### Patch Changes

- Find the personal account by its owner instead of assuming that its name equals the username. ([#3922](https://github.com/expo/eas-cli/pull/3922) by [@byronkarlen](https://github.com/byronkarlen))
- Show the Expo Simulators hint after a successful build from November 12 instead of November 10. ([#4817](https://github.com/expo/eas-cli/pull/4817) by [@williamgrosset](https://github.com/williamgrosset))

## 27.4.1

No changes in this release.

## 27.4.0

### Patch Changes

- Show the Expo Simulators hint after a successful build from November 10 instead of November 5. ([#4801](https://github.com/expo/eas-cli/pull/4801) by [@williamgrosset](https://github.com/williamgrosset))

## 27.3.0

### Patch Changes

- Bump `@expo/apple-utils` to `2.3.0` to fix iOS capability sync when App Store Connect rejects enabling, disabling or changing a capability. ([#4790](https://github.com/expo/eas-cli/pull/4790) by [@douglowder](https://github.com/douglowder))
- Keep already linked App Groups, Merchant IDs and iCloud containers when capability sync links another identifier. ([#4584](https://github.com/expo/eas-cli/pull/4584) by [@ceydaakin](https://github.com/ceydaakin))

## 27.2.0

### Minor Changes

- Add an experiment that suggests Expo Update to coding agents after a build when the Free plan account is within 5 builds of the platform limit. ([#4758](https://github.com/expo/eas-cli/pull/4758) by [@williamgrosset](https://github.com/williamgrosset))
- Add `eas observe:traces` to list request trace spans (or a summary of span names and counts), `eas observe:trace` to display one trace as a span tree, and span rows in the `eas observe:session` timeline. ([#4772](https://github.com/expo/eas-cli/pull/4772) by [@kadikraman](https://github.com/kadikraman))
- Show a one-time Expo Simulators hint after a successful build. ([#4768](https://github.com/expo/eas-cli/pull/4768) by [@FiberJW](https://github.com/FiberJW))

### Patch Changes

- Remove the Free plan build limit guidance experiment for coding agents from `eas build`. ([#4757](https://github.com/expo/eas-cli/pull/4757) by [@williamgrosset](https://github.com/williamgrosset))

## 27.1.0

### Minor Changes

- Display queued workflow runs: `workflow:run --wait` and `workflow:status` show a run waiting for its concurrency group and the run blocking it, and `workflow:cancel` includes queued runs in its selection list. ([#4258](https://github.com/expo/eas-cli/pull/4258) by [@hSATAC](https://github.com/hSATAC))
- Upload the workflow files that `uses` jobs reference, including nested ones, when running a local workflow file with `eas workflow:run`. ([#4769](https://github.com/expo/eas-cli/pull/4769) by [@sswrk](https://github.com/sswrk))

### Patch Changes

- Fail the command when EAS CLI cannot pull environment variables from EAS servers, instead of continuing without them. ([#4774](https://github.com/expo/eas-cli/pull/4774) by [@wschurman](https://github.com/wschurman))
- Format the generated root changelog before committing a release. ([#4773](https://github.com/expo/eas-cli/pull/4773) by [@gwdp](https://github.com/gwdp))
- Honor the `--non-interactive` flag in `workflow:cancel`; it was parsed but never applied, so automation could hang on the interactive picker. ([#4258](https://github.com/expo/eas-cli/pull/4258) by [@hSATAC](https://github.com/hSATAC))
- Stop reporting a finish time for workflow runs that have not finished: `workflow:runs` reports `finishedAt` only for runs in a final status. ([#4258](https://github.com/expo/eas-cli/pull/4258) by [@hSATAC](https://github.com/hSATAC))

## 27.0.0

### Major Changes

- Write the reason a command failed to stderr, next to the `command failed.` line, instead of to stdout. A program that reads the reason from stdout must read stderr instead. ([#4592](https://github.com/expo/eas-cli/pull/4592) by [@vonovak](https://github.com/vonovak))

### Minor Changes

- Send the `permissions.account.role` from the build profile to request a role for the build's `EXPO_TOKEN`. ([#4734](https://github.com/expo/eas-cli/pull/4734) by [@wschurman](https://github.com/wschurman))
- Add `simulator:logs` to read and follow logs from an iOS simulator session and download saved logs after it stops. ([#4545](https://github.com/expo/eas-cli/pull/4545) by [@gwdp](https://github.com/gwdp))

### Patch Changes

- Show permission guidance, including `permissions.account.role` in eas.json, when a build request fails with an authorization error. ([#4760](https://github.com/expo/eas-cli/pull/4760) by [@wschurman](https://github.com/wschurman))
- Print the notice about eas-cli in project dependencies only when stderr is a terminal, so programs that read stderr get the command's error. ([#4591](https://github.com/expo/eas-cli/pull/4591) by [@vonovak](https://github.com/vonovak))
- Show account roles and credential permission limits in `eas login` when you are already logged in. ([#4759](https://github.com/expo/eas-cli/pull/4759) by [@wschurman](https://github.com/wschurman))
- Fix simulator control action help routing and show help when a flag is incomplete. ([#4681](https://github.com/expo/eas-cli/pull/4681) by [@gwdp](https://github.com/gwdp))
- Require explicit `host:` simulator-host upload paths and report missing local files. ([#4683](https://github.com/expo/eas-cli/pull/4683) by [@gwdp](https://github.com/gwdp))

  Missing local absolute paths now require the `host:` prefix. Actions that require upload IDs accept local files and reject host paths with an explanation.

## 26.0.0

### Patch Changes

- Regenerate graphql code. ([#4692](https://github.com/expo/eas-cli/pull/4692) by [@wschurman](https://github.com/wschurman))
- Read the app config fewer times in `eas build` and other project commands. An iOS build now runs `expo config` 2 times instead of 6. ([`78ba760`](https://github.com/expo/eas-cli/commit/78ba76001b67c9971236af1a1d02e46c2f82d24a) by [@vonovak](https://github.com/vonovak))
- Share one GraphQL client between the project ID check and the command, so commands send one fewer app query. ([#4646](https://github.com/expo/eas-cli/pull/4646) by [@vonovak](https://github.com/vonovak))
- Show why a simulator session failed in `eas simulator:get`, and add an `errors` array to its `--json` output. For an unknown error, `simulator:start` and `simulator:get` now show the failed step's error from the session logs. ([#4694](https://github.com/expo/eas-cli/pull/4694) by [@brentvatne](https://github.com/brentvatne))
- Show why a simulator session failed in `eas simulator:start`, such as an unknown `--device` name, instead of only the session status. ([#4693](https://github.com/expo/eas-cli/pull/4693) by [@brentvatne](https://github.com/brentvatne))

## 25.3.0

### Minor Changes

- Add a Free plan build limit checkout experiment to `eas build` that offers to open the Starter plan checkout. ([#4633](https://github.com/expo/eas-cli/pull/4633) by [@williamgrosset](https://github.com/williamgrosset))
- Add a `--system-image` flag to `eas simulator:start` to select the Android SDK system image for the emulator. ([#4500](https://github.com/expo/eas-cli/pull/4500) by [@krystofwoldrich](https://github.com/krystofwoldrich))

## 25.2.0

### Minor Changes

- Add experimentation client. ([#4558](https://github.com/expo/eas-cli/pull/4558) by [@williamgrosset](https://github.com/williamgrosset))
- Add a Free plan build limit guidance experiment for coding agents to `eas build`. ([#4631](https://github.com/expo/eas-cli/pull/4631) by [@williamgrosset](https://github.com/williamgrosset))
- Add `eas simulator:control` to run serve-sim actions, with file upload and download, on a remote iOS simulator session. ([#4641](https://github.com/expo/eas-cli/pull/4641) by [@gwdp](https://github.com/gwdp))

## 25.1.1

No changes in this release.

## 25.1.0

### Minor Changes

- Show EAS Simulator minutes in `eas account:usage`. ([#4583](https://github.com/expo/eas-cli/pull/4583) by [@LipLoody](https://github.com/LipLoody))
- Add `--cors-origin` to `eas simulator:start`, so a third party page can call the simulator preview API, for example with `@expo/hub-client`. ([#4658](https://github.com/expo/eas-cli/pull/4658) by [@krystofwoldrich](https://github.com/krystofwoldrich))
- Add `--frame-ancestor` to `eas simulator:start`, so a third party site can embed the simulator preview, and print the embeddable preview URL. ([#4656](https://github.com/expo/eas-cli/pull/4656) by [@krystofwoldrich](https://github.com/krystofwoldrich))

## 25.0.0

### Major Changes

- Default new simulator sessions to authenticated preview links and omit preview credentials from private output; use `simulator:start --public-link` for public sharing, while `simulator:get` follows the saved preference. ([#4619](https://github.com/expo/eas-cli/pull/4619) by [@gwdp](https://github.com/gwdp))

### Minor Changes

- Use effectivePermissions for logic about capabilities and account:view display. ([#4637](https://github.com/expo/eas-cli/pull/4637) by [@wschurman](https://github.com/wschurman))

### Patch Changes

- Update error message for scoped VC in EAS CLI now that scoped can be used outside build. ([#4636](https://github.com/expo/eas-cli/pull/4636) by [@wschurman](https://github.com/wschurman))
