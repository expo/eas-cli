# @expo/simulator-launcher

Prepare an iOS Simulator with serve-sim, agent-device and Argent before an EAS job arrives.
Requires macOS. Only vm-tools is image-installed; its startup script runs the launcher:

```sh
export EXPO_SIMULATOR_STARTUP=1
export EXPO_SIMULATOR_DEVICE="iPhone 17"
exec bunx @expo/simulator-launcher@latest start
```

## Commands

- `start`: boot the selected Simulator and launch the tools in the foreground.
- `claim ENGINE [DEVICE]`: hand the warm device to one job. Engines: `serve-sim`, `agent-device`,
  `argent`. Omit DEVICE to reuse it, or pass an exact name or UDID to select another.
  A claim waits only for its engine and stops the other tools. Replacement boots the requested
  device while the old tools and serve-sim stop; the old device shuts down in the background.
- `stop`: disable preparation for this VM boot and wait for owned resources to be cleaned up.

```sh
node "$HOME/.expo/simulator-tools/run" claim serve-sim
# Returns one JSON record with the device, boot, engine, controller identity and tool paths.
bunx @expo/simulator-launcher@latest stop
```

`start` copies its self-contained JavaScript bundle to `$HOME/.expo/simulator-tools/run`.
Later package `claim`/`stop` commands use that installed bundle, so the same implementation controls
this boot even if `latest` changes; the direct Node command works without package resolution.

Before any launcher has downloaded, the package `stop` command still disables later preparation.
Once startup has claimed this boot, stop requires its cleanup confirmation, even if the copy is missing.

The launcher has one durable state file: `/tmp/expo-simulator-startup.json`, shared by all commands
regardless of HOME/TMPDIR. It contains the lifecycle, claim and native session metadata. A short
boot-scoped filesystem lock serializes updates; an abandoned lock fails closed without takeover.
This private format requires a fresh VM; there is no live migration.

## Environment

The startup script owns Node/Bun/PATH setup and these optional overrides:

- `EXPO_SIMULATOR_STARTUP=1` enables preparation; `EXPO_SIMULATOR_DEVICE` selects an exact name or UDID.
  Without a selector, start uses the shortest available iPhone name.
- `SERVE_SIM_VERSION`, `AGENT_DEVICE_VERSION`, `ARGENT_VERSION`: tool versions, each defaulting to `latest`.
- `AGENT_DEVICE_STATE_DIR`, `ARGENT_EVENT_LOG`: tool state/output locations.
- Agent-device daemon/runner idle timers default to off. Override with
  `AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS` / `AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS` (milliseconds).

## Boundaries

- Preparation is a warmup opportunity, not proof that every service is ready. Build-tools checks
  the tools and performs serve-sim's private `--adopt` handoff before app actions.
- One start attempt and one accepted claim per VM boot. Stop is permanent for that boot;
  a failed replacement cannot skip cleanup and start another device.
- A session is ready once its device has booted, apsd has been disabled and serve-sim answers.
- Warmup also tries to preinstall the latest stable Expo Go. It only checks for ffmpeg, which the VM
  image provides. Ordinary failures warn. A failed apsd disable leaves push notifications running;
  warm jobs do not retry it, and they do not use push notifications. Claim prevents a late Expo Go
  install, waiting only if native install already started, and its record names the preinstalled
  Expo Go for the same device; the job's requested app remains authoritative.
- Stop has a caller timeout, not a global cleanup deadline. A timeout or cleanup error does not prove
  teardown completed, and EAS must not start a fallback session until cleanup is confirmed.
