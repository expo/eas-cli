# @expo/simulator-launcher

Warm iOS Simulators before an EAS job arrives. Requires macOS.
The image installs vm-tools and writes its startup script at
`/Volumes/My Shared Files/expo-startup/startup.sh`:

```sh
export EXPO_SIMULATOR_STARTUP=1
export EXPO_SIMULATOR_DEVICE="iPhone Duo,iPhone 18"
exec bunx @expo/simulator-launcher@latest start
```

## Commands

- `start`: warm the default device in the foreground. Once its tools and Expo Go preinstall finish,
  warm the remaining devices only while the session is still unclaimed.
- `claim ENGINE [DEVICE]`: give one device to one job. Engines: `serve-sim`, `agent-device`, `argent`. No DEVICE means the first configured device. A matching warm device is reused;
  its device and port are returned, and the other device is stopped in the background.
  Otherwise the requested device boots while the old servers/tools stop. Old devices shut down
  in the background, without delaying the replacement's startup.
- `stop`: permanently end warmup for this boot and wait for all owned resources to be cleaned up.

```sh
# Build-tools reads LAUNCHER_VERSION from the version recorded by start.
bun x --no-install "@expo/simulator-launcher@$LAUNCHER_VERSION" claim serve-sim
bun x --no-install "@expo/simulator-launcher@$LAUNCHER_VERSION" stop
```

There is no copied launcher bundle. Build-tools uses the recorded package version for claim/stop;
Warmup primes Bun’s exact-version cache before ready, with two attempts of up to 30 seconds. Claim/stop use `--no-install`, retrying
once with the registry only when Bun cannot find that cached binary. Priming failures warn.
Before start has run,
stop uses the normal package-manager path and still disables later warmup for this boot.

One durable state file, `/tmp/expo-simulator-startup.json`, holds the lifecycle, launcher version,
devices/ports, claim and native identity. It is independent of HOME/TMPDIR. A short boot-scoped lock
serializes updates; an abandoned lock fails closed. This private format requires a fresh VM.

## Environment

- `EXPO_SIMULATOR_STARTUP=1` enables warmup.
- `EXPO_SIMULATOR_DEVICE` is a comma-separated list of exact device names or UDIDs. Entries are
  trimmed and must each identify one available device. The first is the default. Unset keeps
  the shortest available iPhone name, as does an empty or blank value. Empty list entries, missing,
  ambiguous or duplicate devices fail clearly.
- `SERVE_SIM_VERSION`, `AGENT_DEVICE_VERSION`, `ARGENT_VERSION`: each defaults to `latest`.
- `AGENT_DEVICE_STATE_DIR`, `ARGENT_EVENT_LOG`: tool state/output locations.
- Agent-device idle timers default to off. Override with `AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS`
  and `AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS` (milliseconds).

## Boundaries

- Ready means the default device booted, its apsd disable attempt finished and serve-sim answers.
  The second device may not have started yet. Its startup failure leaves the default available.
  Claim waits for the selected device; job-time native,
  version and authentication checks plus private serve-sim adoption remain authoritative.
- Agent-device prestarts on the default device only. A secondary claim prepares its runner after
  the old tools stop. One device-independent Argent server is reused for the claimed device.
- Warmup downloads/extracts the latest stable Expo Go once and reuses it for the second device.
  Each initial device gets a preinstall attempt; ordinary failures
  warn. Claim prevents new preinstalls and waits for a selected-device native install already in
  flight. Unused-device preinstalls drain during background cleanup. Job app installs remain
  authoritative. Replacements do not preinstall again. The VM image provides ffmpeg.
- One start attempt and one accepted claim per boot. Failed cleanup never permits another session.
  Stop's caller timeout is not a global cleanup deadline or proof that teardown completed.
  A build-tools claim timeout uses normal startup only after confirmed terminal cleanup.
