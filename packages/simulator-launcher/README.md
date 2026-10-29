# @expo/simulator-launcher

Warm an iOS Simulator and its tools before an EAS job arrives. Requires macOS.
The VM's startup script at `/usr/local/share/vm-tools/startup.sh` can run:

```sh
export EXPO_SIMULATOR_STARTUP=1
export EXPO_SIMULATOR_DEVICE="iPhone Duo"
exec bunx @expo/simulator-launcher@latest start
```

- `start` runs one orphan serve-sim, Argent and agent-device in the foreground.
- `claim ENGINE [DEVICE]` reserves one job and returns the selected device separately from the
  existing server's identity, port and credentials. Engines: `serve-sim`, `agent-device`, `argent`.
  Omit DEVICE to use the startup device. Claim does not wait for the selected tool or boot another
  device; build-tools privately adopts the requested device on the existing serve-sim port.
- `prepare-tools` continues the consumed claim after adoption. It reuses global Argent or the
  default agent-device runner, or prepares an agent-device runner for the newly selected device.
- `stop` waits for owned processes, background work and Simulators to be cleaned up.

Build-tools uses the package version recorded by `start` for `claim`, `prepare-tools` and `stop`.
There is no copied bundle. Warmup primes Bun's exact-version cache before ready, with two attempts
of up to 30 seconds. Build-tools calls use `--no-install`; only a cache-resolution failure retries
against the registry. Priming failures warn. Stop before start disables startup for this VM boot.

The single private record `/tmp/expo-simulator-startup.json` contains lifecycle, launcher version,
selected device, controller and server identity, credentials and tool paths. A boot-scoped lock
serializes state updates. An abandoned lock fails closed. The file is independent of HOME/TMPDIR.
This format and port-based adoption require the matching serve-sim release and a fresh VM.

`EXPO_SIMULATOR_DEVICE` selects an exact device name or UDID. Unset or blank selects the available
iPhone with the shortest name. `SERVE_SIM_VERSION`, `AGENT_DEVICE_VERSION` and `ARGENT_VERSION`
default to `latest`. `AGENT_DEVICE_STATE_DIR` and `ARGENT_EVENT_LOG` control tool state locations.
Agent-device's daemon and runner idle timers default to off. The image provides ffmpeg.

Ready means the startup device booted, its apsd disable attempt finished and serve-sim answers.
It does not mean all tools are ready. A claim reserves a device; private adoption must confirm the
same server, selected-device readiness and native capture before tool validation and app actions.
One start attempt and one job claim are allowed per boot. Cleanup failures never report disabled.
A caller timeout is not a global cleanup deadline or proof that teardown finished.

Claim and tool JSON include credentials; capture them rather than streaming them to job logs.
