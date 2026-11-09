# @expo/simulator-launcher

Prepare iOS Simulators and native tools, cache Expo Go and Appium files, and claim prepared sessions. Requires macOS.

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
- `prefetch`: cache the selected Expo Go archive for reuse. With `APPIUM_VERSION` and `XCUITEST_VERSION`, prepare Appium, XCUITest and WebDriverAgent files. It does not fetch serve-sim, agent-device or Argent. Progress goes to stderr; the command stops at the first failure.

Consumers use the launcher version recorded by `start` for session commands (`LAUNCHER_VERSION`
below). Run these in another process:

```sh
bun x "@expo/simulator-launcher@$LAUNCHER_VERSION" claim serve-sim
# After adoption confirms the selected device and native ACK:
bun x "@expo/simulator-launcher@$LAUNCHER_VERSION" prepare-tools
bun x "@expo/simulator-launcher@$LAUNCHER_VERSION" stop
```

To cache files without booting devices:

```sh
simulator-launcher prefetch
```

Session adoption requires the serve-sim release supporting port-based device adoption.

One durable state file, `/tmp/expo-simulator-startup.json`, holds the lifecycle, launcher version,
selected device, server credentials, claim and native identity. It is independent of HOME/TMPDIR. A short boot-scoped lock
serializes updates; an abandoned lock fails closed. State is scoped to the current boot.
`start` uses the supplied runtime package versions and records exact version inputs as
`serveSimVersion`, `agentDeviceVersion` and `argentVersion` in this state and the claim. Consumers
compare explicit package requests with these versions before reuse. Tags, ranges and unset inputs
do not report an exact version. Build-tools also uses `serveSimVersion` for warm adoption and recordings.

## Environment

- `EXPO_SIMULATOR_STARTUP=1` enables warmup.
- `EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0` turns off the Expo Go preinstall.
- `EXPO_SIMULATOR_DEVICE` is a comma-separated list of exact device names or UDIDs. Entries are
  trimmed and must each identify one available device. The first is the default. Unset keeps
  the shortest available iPhone name, as does an empty or blank value. Empty list entries, missing,
  ambiguous or duplicate devices fail clearly.
- `SERVE_SIM_VERSION`, `AGENT_DEVICE_VERSION`, `ARGENT_VERSION` (`start` only): runtime
  package selections, each defaulting to `latest`. The launcher passes them to Bun without a separate
  version lookup. Callers that select exact versions can identify them in state and claims.
  `prefetch` ignores these settings and never records them in `prepared.json`.
- `EXPO_GO_SDK_VERSION`: select an SDK for `prefetch` and `start` with an https iOS Simulator archive
  in the Expo versions API. Unset selects the latest stable SDK; a pin must be `x.y.z` and may select
  a beta. `start` reuses recorded SDK/archive metadata when it matches the supplied SDK, or when
  no SDK is supplied. Without matching metadata, startup selects from the API using this variable
  or the latest stable SDK. Ignored when `EXPO_SIMULATOR_PREINSTALL_EXPO_GO=0`.
- `APPIUM_VERSION`, `XCUITEST_VERSION` (`prefetch` only): exact versions (`x.y.z`), both or
  neither. Any other value makes `prefetch` fail.
- `AGENT_DEVICE_STATE_DIR`, `ARGENT_EVENT_LOG`: tool state/output locations.
- Agent-device idle timers default to off. Override with `AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS`
  and `AGENT_DEVICE_IOS_RUNNER_IDLE_STOP_MS` (milliseconds).

## Prepared files

`prefetch` writes `expo-go/` and `appium/` under `~/Library/Caches/expo-simulator-startup/`, and
removes each one when its step is skipped. Each reader checks the files before it uses them and
otherwise runs its normal download or install. Keep these directories when reusing prepared files.

- `expo-go/<sha256 of the archive URL>.tar.gz`: `start` uses the recorded URL when its SDK matches
  the supplied selection, or when no SDK is supplied. It checks the file with `gzip -t` before
  extraction. A missing or damaged archive is downloaded again from that URL.
- `appium/`: an Appium home with the pinned xcuitest driver and WebDriverAgent runner.
  Prefetch checks the runner's bundle metadata and executable before recording it.
  Build-tools reuses it when the files match the manifest and Appium matches the current
  resolution of an explicit version request, including ranges and `latest`. Without an override,
  the prepared version must satisfy the default Appium 3 range. Build-tools does not write or
  remove this home. These checks do not load the driver or launch WDA; validate reuse with a
  real Appium session.

### Prepared tool manifest

`prefetch` writes `~/Library/Caches/expo-simulator-startup/prepared.json` after all requested
steps and temporary-file cleanup succeed. Before refreshing caches, it removes the previous
manifest. Skipped tools are absent from the new manifest; a failed preparation publishes no new one.

The JSON has a `tools` map:

- `appium.version`, `appium.xcuitest`, `appium.home`: the prepared Appium and XCUITest versions
  and the absolute Appium home path. This entry is written only after WDA preparation succeeds.

When Expo Go is enabled, `expo-go.sdk` and `expo-go.url` in `tools` record its selected SDK and archive URL.
The SDK identifies the selected Expo release, not the app's binary version. With every step
disabled or unset, the manifest is `{"tools":{}}`.

`start` reads only the optional Expo Go selection from this manifest. Missing or invalid Expo Go
metadata, or metadata for a different supplied SDK, uses normal SDK/archive selection. Legacy
serve-sim, agent-device and Argent entries are ignored, including malformed entries. Exact CLI
version inputs are recorded only in the current boot's state and claim.

Build-tools' shared `readPreparedSimulatorToolAsync(tool, schema)` reader selects an entry from
`tools` using the consumer's schema. Each consumer checks compatibility before reuse. Missing,
invalid or older metadata is a cache miss and uses normal setup.

Keep the Expo Go archive and the whole Appium home, not only the manifest. Appium's home
must stay at the recorded path under the same user. Rerun `prefetch` to regenerate the manifest
when changing versions. Metadata does not prove that a driver loads or WDA launches; validate
Appium reuse with a real session.

## Boundaries

Native warmup still runs serve-sim, agent-device and Argent. Bun may cache their packages as a side
effect; these incidental caches are retained. The caller supplies the requested package selections
for each boot, and Bun reuses matching files or fetches the requested versions. Native build-cache
reuse depends on the selected version and device.

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
- Warmup uses the prepared Expo Go selection, or the standalone SDK selection when none exists, once, from the
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
