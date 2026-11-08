# @expo/simulator-launcher

Prepare iOS Simulators and native tools, cache packages, and claim prepared sessions. Requires macOS.

Start the launcher with the devices you want to prepare:

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
- `prefetch`: cache pinned serve-sim, agent-device and Argent packages with Bun. Cache the selected Expo Go archive for reuse. Progress goes to stderr; the command stops at the first failure.

Consumers use the launcher version recorded by `start` for session commands (`LAUNCHER_VERSION`
below). Run these in another process:

```sh
bun x "@expo/simulator-launcher@$LAUNCHER_VERSION" claim serve-sim
# After adoption confirms the selected device and native ACK:
bun x "@expo/simulator-launcher@$LAUNCHER_VERSION" prepare-tools
bun x "@expo/simulator-launcher@$LAUNCHER_VERSION" stop
```

To populate caches separately:

```sh
simulator-launcher prefetch
```

Session adoption requires the serve-sim release supporting port-based device adoption.

One durable state file, `/tmp/expo-simulator-startup.json`, holds the lifecycle, launcher version,
selected device, server credentials, claim and native identity. It is independent of HOME/TMPDIR. A short boot-scoped lock
serializes updates; an abandoned lock fails closed. State is scoped to the current boot.

## Environment

- `EXPO_SIMULATOR_STARTUP=1` enables warmup.
- `EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0` turns off the Expo Go preinstall.
- `EXPO_SIMULATOR_DEVICE` is a comma-separated list of exact device names or UDIDs. Entries are
  trimmed and must each identify one available device. The first is the default. Unset keeps
  the shortest available iPhone name, as does an empty or blank value. Empty list entries, missing,
  ambiguous or duplicate devices fail clearly.
- `SERVE_SIM_VERSION`, `AGENT_DEVICE_VERSION`, `ARGENT_VERSION`: each defaults to `latest`, which
  resolves again at boot. `prefetch` caches each package whose version is set to an exact version
  (`x.y.z`), and skips each unset package. Any other value, such as an explicit `latest`, makes
  `prefetch` fail. Use the same versions when preparing and starting tools. Later commands
  take these packages from Bun's cache. Bun can still revalidate dependency manifests with
  the registry.
- `EXPO_GO_SDK_VERSION`: an SDK for which the Expo versions API lists an iOS Simulator archive,
  `start` and `prefetch` then use the Expo Go of that SDK, even a beta, instead
  of the latest stable one. Unset or empty keeps the latest stable one. Both still ask the versions
  API for the archive URL. `prefetch` fails when the value is not `x.y.z`, or when the API lists no
  https Simulator archive for it. In these cases, `start` warns and preinstalls no Expo Go. Use the
  same value when preparing and starting tools.
- `AGENT_DEVICE_STATE_DIR`, `ARGENT_EVENT_LOG`: tool state/output locations.
- Agent-device idle timers default to off. Override with `AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS`
  and `AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS` (milliseconds).

## Prepared files

`prefetch` writes the selected Expo Go archive under `~/Library/Caches/expo-simulator-startup/expo-go/`,
and removes it when the step is skipped. `start` checks the archive before using it and otherwise
downloads as before. Keep this directory when reusing the archive.

- `expo-go/<sha256 of the archive URL>.tar.gz`: `start` still selects the URL from the Expo
  versions API. It uses the file only for that exact URL and checks it with `gzip -t` before it
  extracts it. A damaged archive gives a warning and a download.

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
- Warmup gets the Expo Go of `EXPO_GO_SDK_VERSION`, or else the latest stable one, once, from the
  prefetched archive (see
  [Prepared files](#prepared-files)) or by download, and reuses it for the second device.
  Each initial device gets a preinstall attempt; ordinary failures warn. Claim prevents new
  preinstalls. `prepare-tools` waits for an install still running on the claimed device and
  reports its version, because the job installs its app next. Installs on other devices continue;
  adoption may shut such a device down, and its install then fails with a warning. Terminal stop
  drains them and the download cleanup. Job app installs remain
  authoritative. Replacements do not preinstall again. `ffmpeg` must be available on PATH.
- One start attempt and one accepted claim per boot. Failed cleanup never permits another session.
  Stop's caller timeout is not a global cleanup deadline or proof that teardown completed.
  A build-tools claim timeout uses normal startup only after confirmed terminal cleanup.

Claim and tool JSON include credentials; capture them rather than streaming them to job logs.
