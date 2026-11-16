# @expo/build-tools

`@expo/build-tools` is the core library for the EAS Build service. It implements the build process for React Native projects and for managed Expo applications.

## Repository

https://github.com/expo/eas-cli/tree/main/packages/build-tools

## iOS local egress

Serve-sim owns the resident iOS guard, its policy, native self-check and boot
resources. Build-tools keeps the tunnel, host system proxy, handoff and transport
cleanup. Local-egress jobs explicitly select blocking; ordinary jobs select
pass-through. Both require a serve-sim release with resident egress support.

Standalone Simulator startup uses a temporary serve-sim, checks its authenticated
policy status, then stops that server while retaining the guard for the boot.
Cloning enrolls each exact device separately. A preview must select one device;
resident multi-device previews are unsupported. Existing connections stay open
when blocking is enabled, and resident boot resources remain until confirmed
boot death. Reboot and legacy camera reinjection restrictions still apply.

The iOS native guard and its validation harness live in expo-device-hub's
`Sources/ServeSimEgressGuard`. The shared event relay here serves Android's fence;
resident iOS denial events do not currently have the old per-destination log relay.
