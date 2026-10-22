# eas-cli

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
