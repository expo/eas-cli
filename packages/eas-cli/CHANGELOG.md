# eas-cli

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
