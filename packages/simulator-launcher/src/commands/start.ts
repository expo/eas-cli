import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleepAsync } from 'node:timers/promises';
import { z } from 'zod';

import { stopServicesAndShutdownSimulatorAsync } from './stop';
import {
  setAgentDeviceEnvironmentDefaults,
  startAgentDevicePreparation,
  stopAgentDeviceDaemonAsync,
} from '../utils/agentDevice';
import {
  prepareArgentEnvironmentAsync,
  setArgentEnvironmentDefaults,
  startArgentServer,
} from '../utils/argent';
import { startExpoGoPreinstall } from '../utils/expoGo';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
} from '../utils/processes';
import { startServeSim } from '../utils/serveSim';
import {
  ClaimInputSchema,
  type LauncherState,
  type SimulatorDevice,
  SimulatorDeviceSchema,
  type WarmSessionInfo,
  getInstalledLauncherDirectory,
  readLauncherStateAsync,
  updateLauncherStateAsync,
} from '../utils/state';

type WarmSimulatorSession = {
  prepareAsync(): Promise<WarmSessionInfo>;
  claimAsync(request: z.infer<typeof ClaimInputSchema>): Promise<SimulatorDevice>;
  stopAsync(): Promise<void>;
};

const SimulatorListSchema = z.object({
  devices: z.record(
    z.string(),
    z.array(SimulatorDeviceSchema.extend({ isAvailable: z.boolean().optional() }))
  ),
});

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
          const device = await session.claimAsync(request);
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
              return { ...owned, status: 'claimed', device };
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
}): WarmSimulatorSession {
  const serviceProcesses = new Set<ChildProcessHandle>();
  // Track the attempted device for cleanup; publish currentDevice only after startup succeeds.
  let ownedSimulatorUdid: string | undefined;
  let currentDevice: SimulatorDevice;
  let availableDevices: SimulatorDevice[];
  let agentDevicePrepareProcess: ChildProcessHandle | undefined;
  let argentProcess: ChildProcessHandle | undefined;
  let expoGoPreinstall: ReturnType<typeof startExpoGoPreinstall> | undefined;
  let unusedToolsCleanup: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);

  async function listAvailableSimulatorsAsync(): Promise<SimulatorDevice[]> {
    const { devices } = SimulatorListSchema.parse(
      JSON.parse(
        await commands.runAsync(
          'xcrun',
          ['simctl', 'list', 'devices', 'available', '--json'],
          signal
        )
      )
    );
    return Object.values(devices)
      .flat()
      .filter(device => device.isAvailable !== false);
  }

  async function resolveSimulatorDeviceAsync(
    selector?: string,
    refreshOnMiss = false
  ): Promise<SimulatorDevice> {
    for (let attempt = 0; ; attempt++) {
      const matches = selector
        ? availableDevices.filter(
            device =>
              device.name === selector || device.udid.toLowerCase() === selector.toLowerCase()
          )
        : availableDevices
            .filter(device => device.name.startsWith('iPhone'))
            .sort((a, b) => a.name.length - b.name.length)
            .slice(0, 1);
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1 || !refreshOnMiss || attempt === 1) {
        throw new Error(
          `Could not select one available Simulator for ${selector ?? 'the default iPhone'}. Use an exact available device name or UDID.`
        );
      }
      await throwIfStoppingAsync();
      availableDevices = await listAvailableSimulatorsAsync();
    }
  }

  async function bootSimulatorAndStartServicesAsync(device: SimulatorDevice): Promise<void> {
    await throwIfStoppingAsync();
    ownedSimulatorUdid = device.udid;
    const simulatorBootPromise = commands
      .runAsync('xcrun', ['simctl', 'bootstatus', ownedSimulatorUdid, '-b'], signal)
      .catch(async () => {
        signal.throwIfAborted();
        await commands.runAsync('xcrun', ['simctl', 'bootstatus', ownedSimulatorUdid!], signal);
      });
    if (!expoGoPreinstall) {
      expoGoPreinstall = startExpoGoPreinstall(device.udid, simulatorBootPromise, signal);
      void expoGoPreinstall.resultPromise.catch(onBackgroundFailure);
    }
    const argentPreparationPromise = prepareArgentEnvironmentAsync(signal);
    const serveSimPromise = simulatorBootPromise.then(() => {
      serviceProcesses.add(startServeSim(ownedSimulatorUdid!, signal));
    });
    const agentDevicePromise = simulatorBootPromise.then(async () => {
      agentDevicePrepareProcess = startAgentDevicePreparation(ownedSimulatorUdid!, signal);
      serviceProcesses.add(agentDevicePrepareProcess);
      await Promise.race([
        agentDevicePrepareProcess.resultPromise,
        new Promise<never>((_resolve, reject) => {
          const aborted = (): void => reject(signal.reason);
          signal.addEventListener('abort', aborted, { once: true });
          if (signal.aborted) {
            aborted();
          }
        }),
      ]);
    });
    const argentPromise = Promise.all([simulatorBootPromise, argentPreparationPromise]).then(() => {
      argentProcess = startArgentServer(signal);
      serviceProcesses.add(argentProcess);
    });
    try {
      await Promise.all([serveSimPromise, agentDevicePromise, argentPromise]);
    } catch (error) {
      onPreparationFailure(error);
      await Promise.allSettled([
        simulatorBootPromise,
        argentPreparationPromise,
        serveSimPromise,
        agentDevicePromise,
        argentPromise,
      ]);
      throw error;
    }
  }

  return {
    async prepareAsync(): Promise<WarmSessionInfo> {
      availableDevices = await listAvailableSimulatorsAsync();
      const selectedDevice = await resolveSimulatorDeviceAsync(process.env.EXPO_SIMULATOR_DEVICE);
      setArgentEnvironmentDefaults();
      setAgentDeviceEnvironmentDefaults();
      const controllerStartTime = (
        await commands.runAsync('ps', ['-p', String(process.pid), '-o', 'lstart='], signal)
      ).trim();
      if (!controllerStartTime) {
        throw new Error(
          'Could not read the Simulator launcher process start time; the warm session cannot be verified.'
        );
      }
      await bootSimulatorAndStartServicesAsync(selectedDevice);
      currentDevice = selectedDevice;
      return {
        device: currentDevice,
        controllerPid: process.pid,
        controllerStartTime,
        agentDeviceStateDir: process.env.AGENT_DEVICE_STATE_DIR!,
        argentEventLogPath: process.env.ARGENT_EVENT_LOG!,
      };
    },

    async claimAsync(request: z.infer<typeof ClaimInputSchema>): Promise<SimulatorDevice> {
      await expoGoPreinstall?.claimAsync();
      await throwIfStoppingAsync();
      const device =
        !request.requestedDevice ||
        request.requestedDevice.toLowerCase() === currentDevice.udid.toLowerCase()
          ? currentDevice
          : await resolveSimulatorDeviceAsync(request.requestedDevice, /* refreshOnMiss */ true);
      if (device.udid.toLowerCase() !== currentDevice.udid.toLowerCase()) {
        // Replacement drains the old native resources without completing terminal shutdown.
        await stopServicesAndShutdownSimulatorAsync(
          serviceProcesses,
          ownedSimulatorUdid,
          agentDevicePrepareProcess
        );
        ownedSimulatorUdid = undefined;
        agentDevicePrepareProcess = undefined;
        argentProcess = undefined;
        await throwIfStoppingAsync();
        await bootSimulatorAndStartServicesAsync(device);
        currentDevice = device;
      }
      const unusedTools: Promise<void>[] = [];
      if (request.engine !== 'argent') {
        unusedTools.push(
          stopProcessAndDescendantsAsync(argentProcess!).then(() => {
            serviceProcesses.delete(argentProcess!);
          })
        );
      }
      if (request.engine !== 'agent-device') {
        unusedTools.push(stopAgentDeviceDaemonAsync());
      }
      unusedToolsCleanup = Promise.allSettled(
        unusedTools.map(cleanup =>
          cleanup.catch(error => {
            onBackgroundFailure(error);
            throw error;
          })
        )
      );
      return currentDevice;
    },

    /** Drain all owned work. Rejection means terminal cleanup cannot be acknowledged. */
    async stopAsync(): Promise<void> {
      const [unusedToolsResults, expoGoResults] = await Promise.all([
        unusedToolsCleanup,
        Promise.allSettled([expoGoPreinstall?.stopAsync()]),
      ]);
      await stopServicesAndShutdownSimulatorAsync(
        serviceProcesses,
        ownedSimulatorUdid,
        agentDevicePrepareProcess
      );
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
