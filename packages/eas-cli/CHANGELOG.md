# eas-cli

## 25.0.0

### Major Changes

- Default new simulator sessions to authenticated preview links and omit preview credentials from private output; use `simulator:start --public-link` for public sharing, while `simulator:get` follows the saved preference. ([#4619](https://github.com/expo/eas-cli/pull/4619) by [@gwdp](https://github.com/gwdp))

### Minor Changes

- Use effectivePermissions for logic about capabilities and account:view display. ([#4637](https://github.com/expo/eas-cli/pull/4637) by [@wschurman](https://github.com/wschurman))

### Patch Changes

- Update error message for scoped VC in EAS CLI now that scoped can be used outside build. ([#4636](https://github.com/expo/eas-cli/pull/4636) by [@wschurman](https://github.com/wschurman))
