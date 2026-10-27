# @expo/simulator-launcher

Warm an iOS Simulator before an EAS job arrives. Requires macOS.
The image installs vm-tools and writes its startup script at
`/usr/local/share/vm-tools/startup.sh`:

```sh
export EXPO_SIMULATOR_STARTUP=1
export EXPO_SIMULATOR_DEVICE="iPhone Duo"
exec bunx @expo/simulator-launcher@latest start
```

## Commands

- `start`: boot the device, attempt to disable apsd and start serve-sim. Agent-device and Argent
  start alongside it; a claim waits only for its requested tool.
- `claim ENGINE [DEVICE]`: give the warm device to one job. Engines: `serve-sim`, `agent-device`,
  `argent`. No DEVICE means the configured device. A different device boots while the old
  server and tools stop; the old device shuts down in the background.
- `stop`: permanently end warmup for this boot and wait for all owned resources to be cleaned up.

```sh
# Build-tools reads LAUNCHER_VERSION from the version recorded by start.
bun x --no-install "@expo/simulator-launcher@$LAUNCHER_VERSION" claim serve-sim
bun x --no-install "@expo/simulator-launcher@$LAUNCHER_VERSION" stop
```

Start records its package version and primes Bun's exact-version cache before ready, with two
attempts of up to 30 seconds. Claim/stop use `--no-install`, retrying once with the registry only
when Bun cannot find the cached binary. Priming failures warn. Before start has run, stop uses
the normal package-manager path and still disables later warmup for this boot.

One durable state file, `/tmp/expo-simulator-startup.json`, holds the lifecycle, launcher version,
device/port, claim and native identity. It is independent of HOME/TMPDIR. A short boot-scoped lock
serializes updates; an abandoned lock fails closed. This private format requires a fresh VM.

## Environment

- `EXPO_SIMULATOR_STARTUP=1` enables warmup.
- `EXPO_SIMULATOR_DEVICE`: exact device name or UDID. Unset, empty or blank selects the shortest
  available iPhone name. Missing or ambiguous devices fail clearly.
- `SERVE_SIM_VERSION`, `AGENT_DEVICE_VERSION`, `ARGENT_VERSION`: each defaults to `latest`.
- `AGENT_DEVICE_STATE_DIR`, `ARGENT_EVENT_LOG`: tool state/output locations.
- Agent-device idle timers default to off. Override with `AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS`
  and `AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS` (milliseconds).

## Boundaries

- Ready means the device booted, its apsd disable attempt finished and serve-sim answers.
  Job-time native, version and authentication checks plus private serve-sim adoption remain
  authoritative. The VM image provides ffmpeg.
- One start attempt and one accepted claim per boot. Failed cleanup never permits another session.
  Stop's caller timeout is not a global cleanup deadline or proof that teardown completed.
  A build-tools claim timeout uses normal startup only after confirmed terminal cleanup.
