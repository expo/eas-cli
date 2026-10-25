import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';

import { createAgentDeviceTool } from '../utils/agentDevice';
import { createArgentTool } from '../utils/argent';
import { startExpoGoPreinstall } from '../utils/expoGo';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
  terminateProcessGroupAsync,
} from '../utils/processes';
import { startServeSim, waitForServeSimReadyAsync } from '../utils/serveSim';
import {
  bootSimulatorAsync,
  disableApsdAsync,
  listAvailableSimulatorsAsync,
  selectSimulators,
  shutdownSimulatorAsync,
} from '../utils/simulator';
import {
  type ClaimInput,
  ClaimInputSchema,
  type LauncherState,
  type SimulatorDevice,
  type WarmSessionInfo,
  getInstalledLauncherDirectory,
  readLauncherStateAsync,
  updateLauncherStateAsync,
} from '../utils/state';
import { type StartedTool, type WarmTool, startTool } from '../utils/tools';

export async function startAsync(bootUuid: string, sourceBundlePath: string): Promise<number> {
  const initial = await updateLauncherStateAsync(bootUuid, state => {
    if (state?.status === 'disabled') {
      return state;
    }
    if (state) {
      throw new Error(
        'Simulator preparation has already been started or disabled for this VM boot.'
      );
    }
    return { bootUuid, status: 'starting', controllerPid: process.pid };
  });
  if (initial.status === 'disabled') {
    return 0;
  }
  await fs.mkdir(getInstalledLauncherDirectory(), { recursive: true });
  const installedLauncherPath = path.join(getInstalledLauncherDirectory(), 'run');
  const temporaryPath = `${installedLauncherPath}.${process.pid}`;
  try {
    await fs.copyFile(sourceBundlePath, temporaryPath);
    await fs.rename(temporaryPath, installedLauncherPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  await runWarmSimulatorSessionAsync(bootUuid);
  return 0;
}

export async function runWarmSimulatorSessionAsync(bootUuid: string): Promise<void> {
  const shutdown = new AbortController();
  const signal = shutdown.signal;
  const interruption = new Error(
    'Simulator preparation was interrupted; cleanup may still be running.'
  );
  const requestShutdown = (): void => shutdown.abort(interruption);
  process.on('SIGTERM', requestShutdown);
  process.on('SIGINT', requestShutdown);
  const watcherAbort = new AbortController();
  let sessionError: unknown;
  let warm: WarmSessionInfo | undefined;
  function requireOwnedState(
    state: LauncherState | undefined,
    expected?: LauncherState['status']
  ): LauncherState {
    if (
      !state ||
      state.controllerPid !== process.pid ||
      (expected && state.status !== expected) ||
      (warm && state.controllerStartTime && state.controllerStartTime !== warm.controllerStartTime)
    ) {
      throw interruption;
    }
    return state;
  }
  async function throwIfStoppingAsync(): Promise<void> {
    signal.throwIfAborted();
    const state = requireOwnedState(await readLauncherStateAsync(bootUuid));
    if (state.status === 'stopping' || state.status === 'disabled') {
      requestShutdown();
    }
    signal.throwIfAborted();
  }
  const session = createWarmSimulatorSession({
    signal,
    throwIfStoppingAsync,
    onPreparationFailure(error) {
      if (!signal.aborted) {
        sessionError = error;
      }
      shutdown.abort(error);
    },
    onBackgroundFailure(error) {
      sessionError ??= error;
      requestShutdown();
    },
  });
  const watcher = (async () => {
    while (!watcherAbort.signal.aborted) {
      await throwIfStoppingAsync();
      await sleepAsync(100, undefined, { signal: watcherAbort.signal });
    }
  })().catch(error => {
    if (!watcherAbort.signal.aborted && !signal.aborted) {
      sessionError ??= error;
      requestShutdown();
    }
  });
  try {
    try {
      if (process.env.EXPO_SIMULATOR_STARTUP !== '1') {
        requestShutdown();
      }
      await throwIfStoppingAsync();
      warm = await session.prepareAsync();
      await updateLauncherStateAsync(
        bootUuid,
        state => ({
          ...requireOwnedState(state, 'starting'),
          ...warm!,
          status: 'ready',
        }),
        signal
      );
      while (!signal.aborted) {
        const state = requireOwnedState(await readLauncherStateAsync(bootUuid));
        if (state.status === 'claiming') {
          const request = ClaimInputSchema.parse(state);
          const { device, preinstalledExpoGo } = await session.claimAsync(request);
          await updateLauncherStateAsync(
            bootUuid,
            current => {
              const owned = requireOwnedState(current, 'claiming');
              if (
                owned.engine !== request.engine ||
                owned.requestedDevice !== request.requestedDevice
              ) {
                throw interruption;
              }
              return {
                ...owned,
                status: 'claimed',
                device,
                ...(preinstalledExpoGo ? { preinstalledExpoGo } : {}),
              };
            },
            signal
          );
        }
        await sleepAsync(100, undefined, { signal });
      }
    } catch (error) {
      if (!signal.aborted) {
        sessionError ??= error;
      }
    }
    await updateLauncherStateAsync(bootUuid, state => ({
      ...requireOwnedState(state),
      status: 'stopping',
      ...(sessionError !== undefined
        ? { error: sessionError instanceof Error ? sessionError.message : String(sessionError) }
        : {}),
    })).catch(error => {
      sessionError ??= error;
    });
    try {
      await session.stopAsync();
    } catch (error) {
      await updateLauncherStateAsync(bootUuid, state => ({
        ...requireOwnedState(state),
        status: 'stopping',
        error: error instanceof Error ? error.message : String(error),
      })).catch(() => {});
      throw error;
    }
    await updateLauncherStateAsync(bootUuid, state => ({
      ...requireOwnedState(state, 'stopping'),
      status: 'disabled',
    }));
    if (sessionError) {
      throw sessionError;
    }
  } finally {
    watcherAbort.abort();
    await watcher;
    process.off('SIGTERM', requestShutdown);
    process.off('SIGINT', requestShutdown);
  }
}

/** Own resources before preparation starts so every partial attempt can be stopped. */
export function createWarmSimulatorSession({
  signal,
  throwIfStoppingAsync,
  onPreparationFailure,
  onBackgroundFailure,
}: {
  signal: AbortSignal;
  throwIfStoppingAsync(): Promise<void>;
  onPreparationFailure(error: unknown): void;
  onBackgroundFailure(error: unknown): void;
}) {
  const warmTools = [createAgentDeviceTool(), createArgentTool()];
  const serveSims = new Set<ChildProcessHandle>();
  // Track attempted devices for cleanup; publish currentDevice only after startup succeeds.
  const ownedSimulatorUdids = new Set<string>();
  const startedTools = new Map<WarmTool, StartedTool>();
  let currentDevice: SimulatorDevice;
  let availableDevices: SimulatorDevice[];
  let serveSim: ChildProcessHandle | undefined;
  let expoGoPreinstall: ReturnType<typeof startExpoGoPreinstall> | undefined;
  let unusedToolsCleanup: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);
  // A replaced device shuts down in the background; terminal cleanup retries it if needed.
  let previousDeviceShutdown: Promise<void> = Promise.resolve();

  async function resolveDeviceAsync(
    selector?: string,
    refreshOnMiss = false
  ): Promise<SimulatorDevice> {
    for (let attempt = 0; ; attempt++) {
      const matches = selectSimulators(availableDevices, selector);
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1 || !refreshOnMiss || attempt === 1) {
        throw new Error(
          `Could not select one available Simulator for ${selector ?? 'the default iPhone'}. Use an exact available device name or UDID.`
        );
      }
      await throwIfStoppingAsync();
      availableDevices = await listAvailableSimulatorsAsync(signal);
    }
  }

  /**
   * Boots the device and starts serve-sim once `servicesAllowed` settles, then `tools` once
   * serve-sim is ready. Resolves when serve-sim is ready; a tool failure goes to onPreparationFailure.
   */
  async function startDeviceAsync(
    device: SimulatorDevice,
    tools: WarmTool[],
    servicesAllowed: Promise<unknown> = Promise.resolve()
  ): Promise<void> {
    await throwIfStoppingAsync();
    const udid = device.udid;
    ownedSimulatorUdids.add(udid);
    const boot = bootSimulatorAsync(udid, signal);
    if (!expoGoPreinstall) {
      expoGoPreinstall = startExpoGoPreinstall(udid, boot, signal);
      void expoGoPreinstall.resultPromise.catch(onBackgroundFailure);
    }
    const serveSimReady = Promise.all([boot, servicesAllowed]).then(async () => {
      const handle = startServeSim(udid, signal);
      serveSim = handle;
      serveSims.add(handle);
      await waitForServeSimReadyAsync(udid, handle, signal);
    });
    // Tools spawn into the Simulator; starting them while serve-sim arms its own launchctl
    // settings coincided with simctl stalls, so they wait for serve-sim to be ready.
    for (const tool of tools) {
      startedTools.set(tool, startTool(tool, udid, serveSimReady, signal, onPreparationFailure));
    }
    // The job launches apps right after its claim, so apsd is settled before the device is ready.
    const apsd = boot.then(() =>
      disableApsdAsync(udid, signal).catch(error => {
        signal.throwIfAborted();
        process.stderr.write(`Could not disable apsd on ${udid}; continuing: ${error}\n`);
      })
    );
    try {
      await Promise.all([serveSimReady, apsd]);
    } catch (error) {
      onPreparationFailure(error);
      await Promise.allSettled([
        boot,
        apsd,
        servicesAllowed,
        ...[...startedTools.values()].map(tool => tool.ready),
      ]);
      throw error;
    }
  }

  /**
   * The new device boots while the old services stop. The old serve-sim is unclaimed and has
   * nothing to finalize, so its process group stops without a grace wait. Its port 3200 listener
   * is in that group, so the new serve-sim can bind once the group is gone. The old device shuts
   * down in the background and stays owned until it does.
   */
  async function replaceDeviceAsync(
    device: SimulatorDevice,
    requestedTool?: WarmTool
  ): Promise<void> {
    const previousUdid = currentDevice.udid;
    const previousServeSim = serveSim;
    const previousTools = [...startedTools.values()];
    startedTools.clear();
    const release = (async () => {
      // Settle every stop before failing, so cleanup never races a stop still in flight.
      const stops = await Promise.allSettled([
        ...previousTools.map(tool => tool.stopAsync()),
        (async () => {
          if (previousServeSim) {
            await terminateProcessGroupAsync(previousServeSim);
            serveSims.delete(previousServeSim);
          }
        })(),
      ]);
      const failed = stops.find(stop => stop.status === 'rejected');
      if (failed?.status === 'rejected') {
        throw failed.reason;
      }
      await throwIfStoppingAsync();
    })();
    previousDeviceShutdown = release.then(async () => {
      await shutdownSimulatorAsync(previousUdid);
      ownedSimulatorUdids.delete(previousUdid);
    });
    void previousDeviceShutdown.catch(() => {});
    await startDeviceAsync(device, requestedTool ? [requestedTool] : [], release);
    currentDevice = device;
  }

  /** Stops serve-sim and the tools, then shuts down every owned device. */
  async function stopServicesAndDevicesAsync(): Promise<void> {
    const cleanupErrors: unknown[] = [];
    const attempt = (step: Promise<void>) => step.catch(error => cleanupErrors.push(error));
    for (const handle of serveSims) {
      await attempt(stopProcessAndDescendantsAsync(handle));
    }
    if (ownedSimulatorUdids.size) {
      for (const tool of warmTools) {
        await attempt(tool.stopAsync());
      }
    }
    for (const udid of ownedSimulatorUdids) {
      await attempt(shutdownSimulatorAsync(udid));
    }
    try {
      commands.throwIfCommandCloseTimedOut();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors,
        'Warm Simulator cleanup could not be confirmed; services or the device may still be running.'
      );
    }
  }

  return {
    async prepareAsync(): Promise<WarmSessionInfo> {
      availableDevices = await listAvailableSimulatorsAsync(signal);
      const selectedDevice = await resolveDeviceAsync(process.env.EXPO_SIMULATOR_DEVICE);
      const controllerStartTime = (
        await commands.runAsync('ps', ['-p', String(process.pid), '-o', 'lstart='], signal)
      ).trim();
      if (!controllerStartTime) {
        throw new Error(
          'Could not read the Simulator launcher process start time; the warm session cannot be verified.'
        );
      }
      // Claimable once serve-sim is ready; the tools keep warming until a claim selects one.
      await startDeviceAsync(selectedDevice, warmTools);
      currentDevice = selectedDevice;
      return {
        device: currentDevice,
        controllerPid: process.pid,
        controllerStartTime,
        agentDeviceStateDir: process.env.AGENT_DEVICE_STATE_DIR!,
        argentEventLogPath: process.env.ARGENT_EVENT_LOG!,
      };
    },

    async claimAsync(request: ClaimInput) {
      const preinstalledExpoGo = await expoGoPreinstall?.claimAsync();
      await throwIfStoppingAsync();
      const device =
        !request.requestedDevice ||
        request.requestedDevice.toLowerCase() === currentDevice.udid.toLowerCase()
          ? currentDevice
          : await resolveDeviceAsync(request.requestedDevice, /* refreshOnMiss */ true);
      const requestedTool = warmTools.find(tool => tool.name === request.engine);
      if (device.udid.toLowerCase() !== currentDevice.udid.toLowerCase()) {
        await replaceDeviceAsync(device, requestedTool);
      }
      // Unselected tools stop now, even mid-startup, so they do not compete with the job.
      unusedToolsCleanup = Promise.allSettled(
        [...startedTools]
          .filter(([tool]) => tool !== requestedTool)
          .map(([tool, started]) => {
            startedTools.delete(tool);
            return started.stopAsync().catch(error => {
              onBackgroundFailure(error);
              throw error;
            });
          })
      );
      if (requestedTool) {
        await startedTools.get(requestedTool)!.ready;
      }
      // A replacement device has no preinstalled Expo Go.
      const preinstalledHere = preinstalledExpoGo?.udid === currentDevice.udid;
      return { device: currentDevice, ...(preinstalledHere ? { preinstalledExpoGo } : {}) };
    },

    /** Drain all owned work. Rejection means terminal cleanup cannot be acknowledged. */
    async stopAsync(): Promise<void> {
      const [unusedToolsResults, expoGoResults] = await Promise.all([
        unusedToolsCleanup,
        Promise.allSettled([expoGoPreinstall?.stopAsync()]),
      ]);
      await Promise.all([...startedTools.values()].map(tool => tool.cancelAsync()));
      await previousDeviceShutdown.catch(() => {});
      await stopServicesAndDevicesAsync();
      const warmupErrors = [...unusedToolsResults, ...expoGoResults].flatMap(result =>
        result.status === 'rejected' ? [result.reason] : []
      );
      if (warmupErrors.length) {
        throw new AggregateError(
          warmupErrors,
          'Warm Simulator background work could not be cleaned up; cleanup remains incomplete.'
        );
      }
    },
  };
}
