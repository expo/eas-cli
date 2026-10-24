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
import { startServeSim, waitForServeSimReadyAsync } from '../utils/serveSim';
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

type WarmTool = 'agent-device' | 'argent';

/** Push notifications are not used in warm sessions, and apsd's work competes with app installs. */
async function disableApsdAsync(udid: string, signal: AbortSignal): Promise<void> {
  let lastError: unknown;
  for (const domain of ['user/foreground', 'system']) {
    const service = `${domain}/com.apple.apsd`;
    try {
      await commands.runAsync(
        'xcrun',
        ['simctl', 'spawn', udid, 'launchctl', 'disable', service],
        signal
      );
      // bootout fails when apsd is already gone; the list check below decides.
      await commands
        .runAsync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'bootout', service], signal)
        .catch(error => {
          lastError = error;
        });
      const loaded = await commands
        .runAsync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list', 'com.apple.apsd'], signal)
        .then(
          () => true,
          error => {
            if (error.code === 113) {
              return false;
            }
            throw error;
          }
        );
      if (!loaded) {
        return;
      }
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
    }
  }
  throw lastError ?? new Error('apsd is still loaded in the Simulator.');
}
type WarmToolStartup = { controller: AbortController; ready: Promise<void> };

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
  // Track attempted devices for cleanup; publish currentDevice only after startup succeeds.
  const ownedSimulatorUdids = new Set<string>();
  const toolStartups = new Map<WarmTool, WarmToolStartup>();
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

  /** Starts a tool after `servicesAllowed`; a failure before claim fails the warm session closed. */
  function startTool(tool: WarmTool, udid: string, servicesAllowed: Promise<unknown>): void {
    const controller = new AbortController();
    const toolSignal = AbortSignal.any([signal, controller.signal]);
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = (): void => reject(toolSignal.reason);
      toolSignal.addEventListener('abort', abort, { once: true });
      if (toolSignal.aborted) {
        abort();
      }
    });
    void aborted.catch(() => {});
    const ready =
      tool === 'agent-device'
        ? servicesAllowed.then(async () => {
            agentDevicePrepareProcess = startAgentDevicePreparation(udid, toolSignal);
            serviceProcesses.add(agentDevicePrepareProcess);
            await Promise.race([agentDevicePrepareProcess.resultPromise, aborted]);
          })
        : Promise.all([servicesAllowed, prepareArgentEnvironmentAsync(toolSignal)]).then(() => {
            argentProcess = startArgentServer(toolSignal);
            serviceProcesses.add(argentProcess);
          });
    void ready.catch(error => {
      if (!controller.signal.aborted) {
        onPreparationFailure(error);
      }
    });
    toolStartups.set(tool, { controller, ready });
  }

  /** Stops a tool even while it is still starting, then releases its native state. */
  async function stopToolAsync(tool: WarmTool): Promise<void> {
    const startup = toolStartups.get(tool);
    toolStartups.delete(tool);
    startup?.controller.abort();
    await startup?.ready.catch(() => {});
    if (tool === 'agent-device') {
      if (agentDevicePrepareProcess) {
        await stopProcessAndDescendantsAsync(agentDevicePrepareProcess, true);
        serviceProcesses.delete(agentDevicePrepareProcess);
        agentDevicePrepareProcess = undefined;
      }
      await stopAgentDeviceDaemonAsync();
    } else if (argentProcess) {
      await stopProcessAndDescendantsAsync(argentProcess);
      serviceProcesses.delete(argentProcess);
      argentProcess = undefined;
    }
  }

  /**
   * Boots the device, then starts serve-sim and the given tools once `servicesAllowed` settles.
   * Resolves when serve-sim is ready; tools keep starting and report through their startups.
   */
  async function bootSimulatorAndStartServicesAsync(
    device: SimulatorDevice,
    tools: WarmTool[],
    servicesAllowed: Promise<unknown> = Promise.resolve()
  ): Promise<void> {
    await throwIfStoppingAsync();
    const udid = device.udid;
    ownedSimulatorUdids.add(udid);
    const simulatorBootPromise = commands
      .runAsync('xcrun', ['simctl', 'bootstatus', udid, '-b'], signal)
      .catch(async () => {
        signal.throwIfAborted();
        await commands.runAsync('xcrun', ['simctl', 'bootstatus', udid], signal);
      });
    if (!expoGoPreinstall) {
      expoGoPreinstall = startExpoGoPreinstall(udid, simulatorBootPromise, signal);
      void expoGoPreinstall.resultPromise.catch(onBackgroundFailure);
    }
    const servicesReady = Promise.all([simulatorBootPromise, servicesAllowed]);
    for (const tool of tools) {
      startTool(tool, udid, servicesReady);
    }
    const serveSimPromise = servicesReady.then(async () => {
      const serveSim = startServeSim(udid, signal);
      serviceProcesses.add(serveSim);
      await waitForServeSimReadyAsync(udid, serveSim, signal);
    });
    // The job launches apps right after its claim, so apsd is settled before the device is ready.
    const apsdPromise = simulatorBootPromise.then(() =>
      disableApsdAsync(udid, signal).catch(error => {
        signal.throwIfAborted();
        process.stderr.write(`Could not disable apsd on ${udid}; continuing: ${error}\n`);
      })
    );
    try {
      await Promise.all([serveSimPromise, apsdPromise]);
    } catch (error) {
      onPreparationFailure(error);
      await Promise.allSettled([
        simulatorBootPromise,
        apsdPromise,
        servicesAllowed,
        ...[...toolStartups.values()].map(startup => startup.ready),
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
      // Claimable once serve-sim is ready; the tools keep warming until a claim selects one.
      await bootSimulatorAndStartServicesAsync(selectedDevice, ['agent-device', 'argent']);
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
      const requestedTool = (['agent-device', 'argent'] as const).find(
        tool => tool === request.engine
      );
      if (device.udid.toLowerCase() !== currentDevice.udid.toLowerCase()) {
        // Release the old device while the new one boots; services start after the release.
        const previousUdid = currentDevice.udid;
        const release = (async () => {
          await Promise.all([...toolStartups.keys()].map(tool => stopToolAsync(tool)));
          await stopServicesAndShutdownSimulatorAsync(
            serviceProcesses,
            previousUdid,
            agentDevicePrepareProcess
          );
          ownedSimulatorUdids.delete(previousUdid);
          agentDevicePrepareProcess = undefined;
          argentProcess = undefined;
          await throwIfStoppingAsync();
        })();
        await bootSimulatorAndStartServicesAsync(
          device,
          requestedTool ? [requestedTool] : [],
          release
        );
        currentDevice = device;
      }
      // Unselected tools stop now, even mid-startup, so they do not compete with the job.
      const unusedTools = [...toolStartups.keys()]
        .filter(tool => tool !== requestedTool)
        .map(tool => stopToolAsync(tool));
      unusedToolsCleanup = Promise.allSettled(
        unusedTools.map(cleanup =>
          cleanup.catch(error => {
            onBackgroundFailure(error);
            throw error;
          })
        )
      );
      if (requestedTool) {
        await toolStartups.get(requestedTool)!.ready;
      }
      if (request.engine === 'appium') {
        // WDA must not share the Simulator with the warmed agent-device XCTest runner.
        await unusedToolsCleanup;
      }
      return currentDevice;
    },

    /** Drain all owned work. Rejection means terminal cleanup cannot be acknowledged. */
    async stopAsync(): Promise<void> {
      const [unusedToolsResults, expoGoResults] = await Promise.all([
        unusedToolsCleanup,
        Promise.allSettled([expoGoPreinstall?.stopAsync()]),
      ]);
      for (const startup of toolStartups.values()) {
        startup.controller.abort();
      }
      await Promise.allSettled([...toolStartups.values()].map(startup => startup.ready));
      const cleanupErrors: unknown[] = [];
      for (const udid of ownedSimulatorUdids.size ? [...ownedSimulatorUdids] : [undefined]) {
        try {
          await stopServicesAndShutdownSimulatorAsync(
            serviceProcesses,
            udid,
            agentDevicePrepareProcess
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      const warmupErrors = [...unusedToolsResults, ...expoGoResults].flatMap(result =>
        result.status === 'rejected' ? [result.reason] : []
      );
      if (cleanupErrors.length) {
        throw cleanupErrors[0];
      }
      if (warmupErrors.length) {
        throw new AggregateError(
          warmupErrors,
          'Warm Simulator background work could not be cleaned up; cleanup remains incomplete.'
        );
      }
    },
  };
}
