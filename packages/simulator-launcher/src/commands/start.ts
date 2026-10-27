import { once } from 'node:events';
import { setTimeout as sleepAsync } from 'node:timers/promises';

import { createAgentDeviceTool } from '../utils/agentDevice';
import { createArgentTool } from '../utils/argent';
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
  type WarmSimulatorDevice,
  readLauncherStateAsync,
  updateLauncherStateAsync,
} from '../utils/state';
import { type StartedTool, type WarmTool, startTool } from '../utils/tools';

const LAUNCHER_VERSION: string = require('../../package.json').version;

type WarmSimulatorSession = {
  prepareAsync(): Promise<WarmSessionInfo>;
  claimAsync(request: ClaimInput): Promise<{
    device: WarmSimulatorDevice;
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
  async function prepareDefaultDeviceAsync(): Promise<void> {
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
  }

  async function handleOneClaimAsync(): Promise<void> {
    while (!signal.aborted) {
      const state = requireOwnedState(await readLauncherStateAsync(bootUuid));
      if (state.status === 'claiming') {
        const request = ClaimInputSchema.parse(state);
        const { device } = await session.claimAsync(request);
        // Stop can arrive during native work; recheck ownership under the state lock.
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
            };
          },
          signal
        );
        return;
      }
      await sleepAsync(100, undefined, { signal });
    }
    signal.throwIfAborted();
  }

  async function finishSessionAsync(): Promise<void> {
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
    // Only confirmed cleanup may publish disabled, which lets a job safely start cold.
    await updateLauncherStateAsync(bootUuid, state => ({
      ...requireOwnedState(state, 'stopping'),
      status: 'disabled',
    }));
    if (sessionError) {
      throw sessionError;
    }
  }

  try {
    try {
      if (process.env.EXPO_SIMULATOR_STARTUP !== '1') {
        requestShutdown();
      }
      await prepareDefaultDeviceAsync();
      await handleOneClaimAsync();
      if (!signal.aborted) {
        await once(signal, 'abort');
      }
    } catch (error) {
      if (!signal.aborted) {
        sessionError ??= error;
      }
    }

    await finishSessionAsync();
  } finally {
    watcherAbort.abort();
    await watcher;
    process.off('SIGTERM', requestShutdown);
    process.off('SIGINT', requestShutdown);
  }
}

type WarmDeviceSession = {
  device: WarmSimulatorDevice;
  ready: Promise<void>;
  startupSignal: AbortSignal;
  readonly canClaim: boolean;
  cancelStartup(): void;
  /** Release an unclaimed server quickly before reusing its port. */
  releaseServerAsync(): Promise<void>;
  /** Confirm descendant cleanup at the end of the job. */
  stopServerAsync(): Promise<void>;
  shutdownAsync(): Promise<void>;
};

/** Own resources before preparation starts so every partial attempt can be stopped. */
export function createWarmSimulatorSession({
  signal: parentSignal,
  throwIfStoppingAsync,
  onPreparationFailure,
  onBackgroundFailure,
}: {
  signal: AbortSignal;
  throwIfStoppingAsync(): Promise<void>;
  onPreparationFailure(error: unknown): void;
  onBackgroundFailure(error: unknown): void;
}): WarmSimulatorSession {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([parentSignal, lifetime.signal]);
  let preparation: Promise<WarmSessionInfo> | undefined;
  const warmTools = [createAgentDeviceTool(), createArgentTool()];
  // Attempts can reuse a UDID; physical boot ownership is shared until shutdown succeeds.
  const ownedSimulatorUdids = new Set<string>();
  const deviceSessions = new Set<WarmDeviceSession>();
  const startedTools = new Map<WarmTool, StartedTool>();
  let currentDevice: WarmDeviceSession;
  let availableDevices: SimulatorDevice[];
  let toolRetirement: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);
  const deviceRetirements: Promise<void>[] = [];
  let launcherCachePriming: Promise<void> = Promise.resolve();

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

  function startDevice(
    device: WarmSimulatorDevice,
    tools: WarmTool[],
    servicesAllowed: Promise<unknown> = Promise.resolve()
  ): WarmDeviceSession {
    const cancellation = new AbortController();
    const deviceSignal = AbortSignal.any([signal, cancellation.signal]);
    let bootStarted = false;
    let failed = false;
    let retiring = false;
    let serveSim: ChildProcessHandle | undefined;
    const ready = (async () => {
      await throwIfStoppingAsync();
      deviceSignal.throwIfAborted();
      const udid = device.udid;
      bootStarted = true;
      ownedSimulatorUdids.add(udid);
      const boot = bootSimulatorAsync(udid, deviceSignal);
      const serveSimReady = Promise.all([boot, servicesAllowed]).then(async () => {
        const handle = startServeSim(udid, deviceSignal, device.port);
        serveSim = handle;
        await waitForServeSimReadyAsync(udid, handle, deviceSignal, device.port);
      });
      for (const tool of tools) {
        startedTools.set(tool, startTool(tool, udid, serveSimReady, signal, onPreparationFailure));
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
        failed = true;
        if (!cancellation.signal.aborted) {
          onPreparationFailure(error);
        }
        await Promise.allSettled([boot, apsd, serveSimReady, servicesAllowed]);
        throw error;
      }
    })();
    void ready.catch(() => {});
    const owner: WarmDeviceSession = {
      device,
      ready,
      startupSignal: deviceSignal,
      get canClaim() {
        return bootStarted && ownedSimulatorUdids.has(device.udid) && !failed && !retiring;
      },
      cancelStartup() {
        cancellation.abort();
      },
      async releaseServerAsync() {
        retiring = true;
        cancellation.abort();
        await ready.catch(() => {});
        if (serveSim) {
          await terminateProcessGroupAsync(serveSim);
          serveSim = undefined;
        }
      },
      async stopServerAsync() {
        if (serveSim) {
          await stopProcessAndDescendantsAsync(serveSim);
          serveSim = undefined;
        }
      },
      async shutdownAsync() {
        if (ownedSimulatorUdids.has(device.udid)) {
          await shutdownSimulatorAsync(device.udid);
          ownedSimulatorUdids.delete(device.udid);
        }
      },
    };
    // Keep every attempt owned, including one replaced by another attempt on the same UDID.
    deviceSessions.add(owner);
    return owner;
  }

  async function replaceDeviceAsync(
    device: SimulatorDevice,
    requestedTool?: WarmTool
  ): Promise<void> {
    const previousDevices = [...deviceSessions];
    const previousTools = [...startedTools.values()];
    startedTools.clear();
    const release = (async () => {
      const results = await Promise.allSettled([
        ...previousTools.map(tool => tool.stopAsync()),
        ...previousDevices.map(session => session.releaseServerAsync()),
      ]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') {
        throw failed.reason;
      }
      await throwIfStoppingAsync();
    })();
    // Release the old ports before shutdown; final stop still drains this background work.
    const retirement = release.then(async () => {
      const results = await Promise.allSettled(
        previousDevices.map(async session => {
          if (session.device.udid !== device.udid) {
            await session.shutdownAsync();
          }
        })
      );
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') {
        throw failed.reason;
      }
    });
    deviceRetirements.push(
      retirement.catch(error => {
        // The claim observes release failures; final stop retries resources still owned here.
        process.stderr.write(
          `Could not finish replaced Simulator cleanup; final stop will retry: ${error}\n`
        );
      })
    );
    // Boot overlaps the release; new services wait for the old ones to exit.
    const replacement = startDevice(
      { ...device, port: 3200 },
      requestedTool ? [requestedTool] : [],
      release
    );
    await replacement.ready;
    currentDevice = replacement;
  }

  /** Stops services before shutting down every device whose boot was attempted. */
  async function stopServicesAndDevicesAsync(): Promise<void> {
    const cleanupErrors: unknown[] = [];
    const attempt = (step: Promise<void>) => step.catch(error => cleanupErrors.push(error));
    for (const owner of deviceSessions) {
      await attempt(owner.stopServerAsync());
    }
    if (ownedSimulatorUdids.size) {
      for (const tool of warmTools) {
        await attempt(tool.stopAsync());
      }
    }
    const physicalDevices = new Map([...deviceSessions].map(owner => [owner.device.udid, owner]));
    await Promise.all([...physicalDevices.values()].map(owner => attempt(owner.shutdownAsync())));
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

  async function claimExistingDeviceAsync(
    existing: WarmDeviceSession,
    requestedTool?: WarmTool
  ): Promise<void> {
    toolRetirement = Promise.allSettled(
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
    await existing.ready;
    currentDevice = existing;
  }

  async function primeLauncherCacheAsync(first: WarmDeviceSession): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await commands.runAsync(
          'bun',
          ['x', `@expo/simulator-launcher@${LAUNCHER_VERSION}`, '--version'],
          AbortSignal.any([signal, first.startupSignal, AbortSignal.timeout(30_000)])
        );
        return;
      } catch (error) {
        signal.throwIfAborted();
        first.startupSignal.throwIfAborted();
        if (attempt === 1) {
          process.stderr.write(
            `Could not cache the Simulator launcher version; claim/stop may need the registry: ${error}\n`
          );
        }
      }
    }
  }

  async function prepareDefaultAsync(): Promise<WarmSessionInfo> {
    signal.throwIfAborted();
    availableDevices = await listAvailableSimulatorsAsync(signal);
    signal.throwIfAborted();
    const device = await resolveDeviceAsync(process.env.EXPO_SIMULATOR_DEVICE?.trim() || undefined);
    const controllerStartTime = (
      await commands.runAsync('ps', ['-p', String(process.pid), '-o', 'lstart='], signal)
    ).trim();
    signal.throwIfAborted();
    if (!controllerStartTime) {
      throw new Error(
        'Could not read the Simulator launcher process start time; the warm session cannot be verified.'
      );
    }
    const first = startDevice({ ...device, port: 3200 }, warmTools);
    launcherCachePriming = primeLauncherCacheAsync(first);
    await Promise.all([first.ready, launcherCachePriming]);
    currentDevice = first;
    return {
      device: currentDevice.device,
      controllerPid: process.pid,
      controllerStartTime,
      agentDeviceStateDir: process.env.AGENT_DEVICE_STATE_DIR!,
      argentEventLogPath: process.env.ARGENT_EVENT_LOG!,
    };
  }

  return {
    async prepareAsync(): Promise<WarmSessionInfo> {
      return await (preparation ??= prepareDefaultAsync());
    },
    async claimAsync(request: ClaimInput) {
      await throwIfStoppingAsync();
      if (
        request.requestedDevice &&
        selectSimulators(availableDevices, request.requestedDevice).length > 1
      ) {
        throw new Error(
          `More than one warm Simulator matches ${request.requestedDevice}. Use an exact UDID.`
        );
      }
      const matches = [...deviceSessions].filter(
        session =>
          session.canClaim &&
          (!request.requestedDevice
            ? session.device.udid === currentDevice.device.udid
            : session.device.name === request.requestedDevice ||
              session.device.udid.toLowerCase() === request.requestedDevice.toLowerCase())
      );
      if (matches.length > 1) {
        throw new Error(
          `More than one warm Simulator matches ${request.requestedDevice}. Use an exact UDID.`
        );
      }
      const existing = matches[0];
      const requestedTool = warmTools.find(tool => tool.name === request.engine);
      if (!existing) {
        const device = await resolveDeviceAsync(request.requestedDevice, /* refreshOnMiss */ true);
        await replaceDeviceAsync(device, requestedTool);
      } else {
        await claimExistingDeviceAsync(existing, requestedTool);
      }
      if (requestedTool) {
        await startedTools.get(requestedTool)!.ready;
      }
      return { device: currentDevice.device };
    },
    async stopAsync(): Promise<void> {
      const cancellingTools = [...startedTools.values()].map(tool => tool.cancelAsync());
      lifetime.abort();
      for (const owner of deviceSessions) {
        owner.cancelStartup();
      }
      await Promise.all(cancellingTools);
      await preparation?.catch(() => {});
      const unusedToolsResults = await toolRetirement;
      await Promise.allSettled([...deviceSessions].map(owner => owner.ready));
      await Promise.all(deviceRetirements);
      await launcherCachePriming.catch(() => {});
      await stopServicesAndDevicesAsync();
      const errors = unusedToolsResults.flatMap(result =>
        result.status === 'rejected' ? [result.reason] : []
      );
      if (errors.length) {
        throw new AggregateError(
          errors,
          'Warm Simulator background work could not be cleaned up; cleanup remains incomplete.'
        );
      }
    },
  };
}
