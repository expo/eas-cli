# @expo/simulator-launcher

Warm iOS Simulators before an EAS job arrives. Requires macOS.
The image installs vm-tools and writes its startup script at
`/usr/local/share/vm-tools/startup.sh`:

```sh
export EXPO_SIMULATOR_STARTUP=1
export EXPO_SIMULATOR_DEVICE="iPhone Duo,iPhone 18"
exec bunx @expo/simulator-launcher@latest start
```

## Commands

- `start`: run one orphan serve-sim for the configured devices. Its default device becomes ready
  first; additional devices warm in the background. Argent and agent-device prestart on the default.
- `claim ENGINE [DEVICE]`: reserve one job and return its selected device plus the existing server's
  identity, port and credentials. Engines: `serve-sim`, `agent-device`, `argent`, `appium`.
  No DEVICE means the first configured device. Claim does not boot the selected device or wait for
  its tool. Build-tools privately adopts that device on the existing serve-sim port.
- `prepare-tools`: continue the consumed claim after adoption. Keep global Argent, reuse the default
  agent-device runner or prepare a runner for the selected device. Appium waits for old XCTest cleanup.
- `stop`: permanently end warmup for this boot and wait for all owned resources to be cleaned up.

```sh
# Build-tools reads LAUNCHER_VERSION from the version recorded by start.
bun x --no-install "@expo/simulator-launcher@$LAUNCHER_VERSION" claim serve-sim
# After private serve-sim adoption confirms the selected device and native ACK:
bun x --no-install "@expo/simulator-launcher@$LAUNCHER_VERSION" prepare-tools
bun x --no-install "@expo/simulator-launcher@$LAUNCHER_VERSION" stop
```

There is no copied launcher bundle. Build-tools uses the recorded package version for claim/stop;
Warmup primes Bun’s exact-version cache before ready, with two attempts of up to 30 seconds. Its claim/stop calls use `--no-install`, retrying
once with the registry only when Bun cannot find that cached binary. Priming failures warn.
Before start has run,
stop uses the normal package-manager path and still disables later warmup for this boot.

This flow requires the serve-sim release supporting port-based device adoption.

One durable state file, `/tmp/expo-simulator-startup.json`, holds the lifecycle, launcher version,
selected device, server credentials, claim and native identity. It is independent of HOME/TMPDIR. A short boot-scoped lock
serializes updates; an abandoned lock fails closed. This private format requires a fresh VM.

## Environment

- `EXPO_SIMULATOR_STARTUP=1` enables warmup.
- `EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0` turns off the Expo Go preinstall.
- `EXPO_SIMULATOR_DEVICE` is a comma-separated list of exact device names or UDIDs. Entries are
  trimmed and must each identify one available device. The first is the default. Unset keeps
  the shortest available iPhone name, as does an empty or blank value. Empty list entries, missing,
  ambiguous or duplicate devices fail clearly.
- `SERVE_SIM_VERSION`, `AGENT_DEVICE_VERSION`, `ARGENT_VERSION`: each defaults to `latest`.
- `AGENT_DEVICE_STATE_DIR`, `ARGENT_EVENT_LOG`: tool state/output locations.
- Agent-device idle timers default to off. Override with `AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS`
  and `AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS` (milliseconds).

## Boundaries

- Ready means the default device booted and serve-sim answers. The apsd step and the Expo Go
  preinstall run in the background on every listed device. A claim does not wait for them; stop
  joins them.
  The second device may not have started yet. Its startup failure leaves the default available.
  Claim reserves a device; it does not report that device ready. Private adoption must confirm
  the same server PID/port, selected-device readiness and native video/capture before tool setup
  and app actions. Job-time version and authentication checks remain authoritative.
- Agent-device prestarts on the default device only. A secondary claim prepares its runner after
  adoption and old-runner cleanup finish. One device-independent Argent server is reused for the claimed device.
  Appium waits for unused tools to stop before starting its own WDA.
- Warmup downloads/extracts the latest stable Expo Go once and reuses it for the second device.
  Each initial device gets a preinstall attempt; ordinary failures warn. Claim prevents new
  preinstalls. `prepare-tools` waits for an install still running on the claimed device and
  reports its version, because the job installs its app next. Installs on other devices continue;
  adoption may shut such a device down, and its install then fails with a warning. Terminal stop
  drains them and the download cleanup. Job app installs remain
  authoritative. Replacements do not preinstall again. The VM image provides ffmpeg.
- One start attempt and one accepted claim per boot. Failed cleanup never permits another session.
  Stop's caller timeout is not a global cleanup deadline or proof that teardown completed.
  A build-tools claim timeout uses normal startup only after confirmed terminal cleanup.

Claim and tool JSON include credentials; capture them rather than streaming them to job logs.
