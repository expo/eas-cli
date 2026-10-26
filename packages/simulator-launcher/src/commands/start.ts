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
  selectWarmupSimulators,
  shutdownSimulatorAsync,
} from '../utils/simulator';
import {
  type ClaimInput,
  ClaimInputSchema,
  type LauncherState,
  type PreinstalledApp,
  type SimulatorDevice,
  type WarmSessionInfo,
  type WarmSimulatorDevice,
  readLauncherStateAsync,
  updateLauncherStateAsync,
} from '../utils/state';
import { type StartedTool, type WarmTool, startTool } from '../utils/tools';

const LAUNCHER_VERSION: string = require('../../package.json').version;

type WarmSimulatorSession = {
  prepareAsync(): Promise<WarmSessionInfo>;
  startRemainingDevices(): void;
  claimAsync(request: ClaimInput): Promise<{
    device: WarmSimulatorDevice;
    preinstalledExpoGo?: PreinstalledApp;
  }>;
  stopAsync(): Promise<void>;
};

export async function startAsync(bootUuid: string): Promise<number> {
  const initial = await updateLauncherStateAsync(bootUuid, state => {
    if (state?.status === 'disabled') {
      return state;
    }
    if (state) {
      throw new Error(
        'Simulator preparation has already been started or disabled for this VM boot.'
      );
    }
    return {
      bootUuid,
      status: 'starting',
      controllerPid: process.pid,
      launcherVersion: LAUNCHER_VERSION,
    };
  });
  if (initial.status === 'disabled') {
    return 0;
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
      session.startRemainingDevices();
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
                devices: [device],
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

type WarmDeviceSession = {
  device: WarmSimulatorDevice;
  shutdown: AbortController;
  ready: Promise<void>;
  serveSim?: ChildProcessHandle;
  expoGo?: ReturnType<typeof startExpoGoPreinstall>;
};

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
}): WarmSimulatorSession {
  const warmTools = [createAgentDeviceTool(), createArgentTool()];
  const serveSims = new Set<ChildProcessHandle>();
  const ownedSimulatorUdids = new Set<string>();
  const devices = new Map<string, WarmDeviceSession>();
  const startedTools = new Map<WarmTool, StartedTool>();
  let warmDevices: WarmSimulatorDevice[];
  let currentDevice: WarmSimulatorDevice;
  let availableDevices: SimulatorDevice[];
  let claimed = false;
  let stopping = false;
  let unusedToolsCleanup: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);
  let unusedDevicesCleanup: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);
  let previousDeviceShutdown: Promise<void> = Promise.resolve();

  async function resolveDeviceAsync(
    selector?: string,
    refreshOnMiss = false
  ): Promise<SimulatorDevice> {
    for (let attempt = 0; ; attempt++) {
      const matches = selectSimulators(availableDevices, selector);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1 || !refreshOnMiss || attempt === 1) {
        throw new Error(
          `Could not select one available Simulator for ${selector ?? 'the default iPhone'}. Use an exact available device name or UDID.`
        );
      }
      await throwIfStoppingAsync();
      availableDevices = await listAvailableSimulatorsAsync(signal);
    }
  }

  function startDevice(
    device: WarmSimulatorDevice,
    tools: WarmTool[],
    preinstallExpoGo: boolean,
    servicesAllowed: Promise<unknown> = Promise.resolve()
  ): WarmDeviceSession {
    const session: WarmDeviceSession = {
      device,
      shutdown: new AbortController(),
      ready: Promise.resolve(),
    };
    devices.set(device.udid, session);
    session.ready = (async () => {
      await throwIfStoppingAsync();
      const deviceSignal = AbortSignal.any([signal, session.shutdown.signal]);
      deviceSignal.throwIfAborted();
      const udid = device.udid;
      ownedSimulatorUdids.add(udid);
      const boot = bootSimulatorAsync(udid, deviceSignal);
      if (preinstallExpoGo) {
        session.expoGo = startExpoGoPreinstall(udid, boot, deviceSignal);
        void session.expoGo.resultPromise.catch(onBackgroundFailure);
      }
      const serveSimReady = Promise.all([boot, servicesAllowed]).then(async () => {
        const handle = startServeSim(udid, deviceSignal, device.port);
        session.serveSim = handle;
        serveSims.add(handle);
        await waitForServeSimReadyAsync(udid, handle, deviceSignal, device.port);
      });
      for (const tool of tools) {
        startedTools.set(
          tool,
          startTool(tool, udid, serveSimReady, deviceSignal, onPreparationFailure)
        );
      }
      const apsd = boot.then(() =>
        disableApsdAsync(udid, deviceSignal).catch(error => {
          deviceSignal.throwIfAborted();
          process.stderr.write(`Could not disable apsd on ${udid}; continuing: ${error}\n`);
        })
      );
      try {
        await Promise.all([serveSimReady, apsd]);
      } catch (error) {
        if (!session.shutdown.signal.aborted) onPreparationFailure(error);
        await Promise.allSettled([boot, apsd, serveSimReady, servicesAllowed]);
        throw error;
      }
    })();
    void session.ready.catch(() => {});
    return session;
  }

  /** Cancel startup, drain it, then release this device's unclaimed server and its port. */
  async function stopDeviceServerAsync(session: WarmDeviceSession): Promise<void> {
    session.shutdown.abort();
    await session.ready.catch(() => {});
    if (session.serveSim) {
      await terminateProcessGroupAsync(session.serveSim);
      serveSims.delete(session.serveSim);
    }
  }

  async function replaceDeviceAsync(
    device: SimulatorDevice,
    requestedTool?: WarmTool
  ): Promise<void> {
    const previousDevices = [...devices.values()];
    const previousTools = [...startedTools.values()];
    startedTools.clear();
    const release = (async () => {
      const results = await Promise.allSettled([
        ...previousTools.map(tool => tool.stopAsync()),
        ...previousDevices.map(session => stopDeviceServerAsync(session)),
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      await throwIfStoppingAsync();
    })();
    previousDeviceShutdown = release.then(async () => {
      const results = await Promise.allSettled(
        previousDevices.map(async session => {
          await session.expoGo?.stopAsync();
          await shutdownSimulatorAsync(session.device.udid);
          ownedSimulatorUdids.delete(session.device.udid);
          devices.delete(session.device.udid);
        })
      );
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    });
    void previousDeviceShutdown.catch(() => {});
    const replacement = startDevice(
      { ...device, port: 3200 },
      requestedTool ? [requestedTool] : [],
      /* preinstallExpoGo */ false,
      release
    );
    await replacement.ready;
    currentDevice = replacement.device;
  }

  /** Stops services before shutting down every device whose boot was attempted. */
  async function stopServicesAndDevicesAsync(): Promise<void> {
    const cleanupErrors: unknown[] = [];
    const attempt = (step: Promise<void>) => step.catch(error => cleanupErrors.push(error));
    for (const handle of serveSims) await attempt(stopProcessAndDescendantsAsync(handle));
    if (ownedSimulatorUdids.size) {
      for (const tool of warmTools) await attempt(tool.stopAsync());
    }
    for (const udid of ownedSimulatorUdids) await attempt(shutdownSimulatorAsync(udid));
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
      warmDevices = selectWarmupSimulators(availableDevices, process.env.EXPO_SIMULATOR_DEVICE).map(
        (device, index) => ({ ...device, port: 3200 + index * 2 })
      );
      const controllerStartTime = (
        await commands.runAsync('ps', ['-p', String(process.pid), '-o', 'lstart='], signal)
      ).trim();
      if (!controllerStartTime)
        throw new Error(
          'Could not read the Simulator launcher process start time; the warm session cannot be verified.'
        );
      const first = startDevice(warmDevices[0], warmTools, /* preinstallExpoGo */ true);
      await first.ready;
      currentDevice = first.device;
      return {
        device: currentDevice,
        devices: warmDevices,
        controllerPid: process.pid,
        controllerStartTime,
        agentDeviceStateDir: process.env.AGENT_DEVICE_STATE_DIR!,
        argentEventLogPath: process.env.ARGENT_EVENT_LOG!,
      };
    },
    startRemainingDevices(): void {
      if (claimed || stopping) return;
      for (const device of warmDevices.slice(1)) {
        if (!devices.has(device.udid)) startDevice(device, [], /* preinstallExpoGo */ true);
      }
    },
    async claimAsync(request: ClaimInput) {
      claimed = true;
      const preinstalls = new Map(
        [...devices].map(([udid, session]) => {
          const result = session.expoGo?.claimAsync() ?? Promise.resolve(undefined);
          void result.catch(onBackgroundFailure);
          return [udid, result];
        })
      );
      await throwIfStoppingAsync();
      const device =
        !request.requestedDevice ||
        request.requestedDevice.toLowerCase() === currentDevice.udid.toLowerCase()
          ? currentDevice
          : await resolveDeviceAsync(request.requestedDevice, /* refreshOnMiss */ true);
      const requestedTool = warmTools.find(tool => tool.name === request.engine);
      if (device.udid.toLowerCase() !== currentDevice.udid.toLowerCase())
        await replaceDeviceAsync(device, requestedTool);
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
      if (requestedTool) await startedTools.get(requestedTool)!.ready;
      const preinstalledExpoGo = await preinstalls.get(currentDevice.udid);
      return { device: currentDevice, ...(preinstalledExpoGo ? { preinstalledExpoGo } : {}) };
    },
    async stopAsync(): Promise<void> {
      stopping = true;
      await Promise.all([...startedTools.values()].map(tool => tool.cancelAsync()));
      for (const session of devices.values()) session.shutdown.abort();
      const [unusedToolsResults, unusedDeviceResults, expoGoResults] = await Promise.all([
        unusedToolsCleanup,
        unusedDevicesCleanup,
        Promise.allSettled([...devices.values()].map(session => session.expoGo?.stopAsync())),
      ]);
      await Promise.allSettled([...devices.values()].map(session => session.ready));
      await previousDeviceShutdown.catch(() => {});
      await stopServicesAndDevicesAsync();
      const errors = [...unusedToolsResults, ...unusedDeviceResults, ...expoGoResults].flatMap(
        result => (result.status === 'rejected' ? [result.reason] : [])
      );
      if (errors.length)
        throw new AggregateError(
          errors,
          'Warm Simulator background work could not be cleaned up; cleanup remains incomplete.'
        );
    },
  };
}
