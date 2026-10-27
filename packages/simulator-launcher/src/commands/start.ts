import { once } from 'node:events';
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
  startExtraWarmupInBackground(): void;
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
    isReadyAsync: async () =>
      requireOwnedState(await readLauncherStateAsync(bootUuid)).status === 'ready',
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
        const { device, preinstalledExpoGo } = await session.claimAsync(request);
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
              ...(preinstalledExpoGo ? { preinstalledExpoGo } : {}),
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
      session.startExtraWarmupInBackground();
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
  readonly expoGo?: ReturnType<typeof startExpoGoPreinstall>;
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
  isReadyAsync,
  onPreparationFailure,
  onBackgroundFailure,
}: {
  signal: AbortSignal;
  throwIfStoppingAsync(): Promise<void>;
  isReadyAsync(): Promise<boolean>;
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
  let warmDevices: WarmSimulatorDevice[];
  let currentDevice: WarmDeviceSession;
  let availableDevices: SimulatorDevice[];
  let claimed = false;
  let stopping = false;
  let toolRetirement: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);
  const deviceRetirements: Promise<void>[] = [];
  let launcherCachePriming: Promise<void> = Promise.resolve();
  let extraWarmup: Promise<void> | undefined;

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
    preinstallExpoGo: boolean,
    servicesAllowed: Promise<unknown> = Promise.resolve()
  ): WarmDeviceSession {
    const cancellation = new AbortController();
    const deviceSignal = AbortSignal.any([signal, cancellation.signal]);
    let bootStarted = false;
    let failed = false;
    let retiring = false;
    let serveSim: ChildProcessHandle | undefined;
    let expoGo: ReturnType<typeof startExpoGoPreinstall> | undefined;
    const ready = (async () => {
      await throwIfStoppingAsync();
      const isAdditional = preinstallExpoGo && device.udid !== warmDevices[0].udid;
      if (isAdditional && (claimed || stopping || !(await isReadyAsync()))) {
        failed = true;
        return;
      }
      deviceSignal.throwIfAborted();
      const udid = device.udid;
      bootStarted = true;
      ownedSimulatorUdids.add(udid);
      const boot = bootSimulatorAsync(udid, deviceSignal);
      if (preinstallExpoGo && !claimed && !stopping) {
        const shared = [...deviceSessions].find(
          owner => owner.device.udid === warmDevices[0].udid
        )?.expoGo;
        if (isAdditional && shared) {
          expoGo = {
            ...shared,
            resultPromise: shared.preinstallOnDeviceAsync(udid, boot, deviceSignal),
            async claimAsync() {
              return await shared.claimAsync(udid);
            },
            async stopAsync() {
              await shared.stopAsync(udid);
            },
          };
          void expoGo.resultPromise.catch(error => {
            failed = true;
            process.stderr.write(
              `Expo Go preinstall on unused Simulator ${udid} failed; final stop will drain it: ${error}\n`
            );
          });
        } else {
          expoGo = startExpoGoPreinstall(
            udid,
            boot,
            deviceSignal,
            /* reuseArchive */ warmDevices.length > 1
          );
          void expoGo.resultPromise.catch(onBackgroundFailure);
        }
      }
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
          if (preinstallExpoGo && device.udid !== warmDevices[0].udid) {
            process.stderr.write(
              `Could not warm additional Simulator ${device.udid}; a claim will start it normally: ${error}\n`
            );
          } else {
            onPreparationFailure(error);
          }
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
      get expoGo() {
        return expoGo;
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
          try {
            await session.expoGo?.stopAsync();
          } finally {
            // Failed preinstall cleanup must not skip an old device's shutdown.
            // Never shut down the replacement when it reuses a failed warm UDID.
            if (session.device.udid !== device.udid) {
              await session.shutdownAsync();
            }
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
      /* preinstallExpoGo */ false,
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
    const movingTools =
      existing.device.udid !== currentDevice.device.udid && requestedTool?.name === 'agent-device';
    toolRetirement = Promise.allSettled(
      [...startedTools]
        .filter(([tool]) => movingTools || tool !== requestedTool)
        .map(([tool, started]) => {
          startedTools.delete(tool);
          return started.stopAsync().catch(error => {
            onBackgroundFailure(error);
            throw error;
          });
        })
    );
    for (const owner of deviceSessions) {
      if (owner === existing) {
        continue;
      }
      const retirement = (async () => {
        await owner.releaseServerAsync();
        await owner.expoGo?.stopAsync();
        await toolRetirement;
        await owner.shutdownAsync();
      })().catch(error => {
        process.stderr.write(
          `Could not release unused Simulator ${owner.device.udid}; final stop will retry: ${error}\n`
        );
      });
      deviceRetirements.push(retirement);
    }
    if (movingTools && requestedTool) {
      const stopped = await toolRetirement;
      const failed = stopped.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') {
        throw failed.reason;
      }
      await throwIfStoppingAsync();
      startedTools.set(
        requestedTool,
        startTool(
          requestedTool,
          existing.device.udid,
          existing.ready,
          AbortSignal.any([signal, existing.startupSignal]),
          onPreparationFailure
        )
      );
    }
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
    warmDevices = selectWarmupSimulators(availableDevices, process.env.EXPO_SIMULATOR_DEVICE).map(
      (device, index) => ({ ...device, port: 3200 + index * 2 })
    );
    const controllerStartTime = (
      await commands.runAsync('ps', ['-p', String(process.pid), '-o', 'lstart='], signal)
    ).trim();
    signal.throwIfAborted();
    if (!controllerStartTime) {
      throw new Error(
        'Could not read the Simulator launcher process start time; the warm session cannot be verified.'
      );
    }
    const first = startDevice(warmDevices[0], warmTools, /* preinstallExpoGo */ true);
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
    startExtraWarmupInBackground(): void {
      if (claimed || stopping || extraWarmup) {
        return;
      }
      extraWarmup = (async () => {
        const first = currentDevice;
        // Keep second-device work out of the default Expo Go and tool startup critical path.
        await Promise.all([
          first.expoGo?.resultPromise,
          ...[...startedTools.values()].map(tool => tool.ready),
        ]);
        if (claimed || stopping || !(await isReadyAsync())) {
          return;
        }
        for (const device of warmDevices.slice(1)) {
          if (![...deviceSessions].some(owner => owner.device.udid === device.udid)) {
            startDevice(device, [], /* preinstallExpoGo */ true);
          }
        }
      })().catch(error => {
        if (!claimed && !stopping && !signal.aborted) {
          onPreparationFailure(error);
        }
      });
    },
    async claimAsync(request: ClaimInput) {
      claimed = true;
      const preinstalls = new Map(
        [...deviceSessions].map(session => {
          const result = session.expoGo?.claimAsync() ?? Promise.resolve(undefined);
          // Only the selected device's installation can fail the claim below.
          void result.catch(() => {});
          return [session.device.udid, result];
        })
      );
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
      const preinstalledExpoGo = await preinstalls.get(currentDevice.device.udid);
      return {
        device: currentDevice.device,
        ...(preinstalledExpoGo ? { preinstalledExpoGo } : {}),
      };
    },
    async stopAsync(): Promise<void> {
      stopping = true;
      const cancellingTools = [...startedTools.values()].map(tool => tool.cancelAsync());
      lifetime.abort();
      for (const owner of deviceSessions) {
        owner.cancelStartup();
      }
      await Promise.all(cancellingTools);
      await preparation?.catch(() => {});
      await extraWarmup;
      const [unusedToolsResults, expoGoResults] = await Promise.all([
        toolRetirement,
        Promise.allSettled([...deviceSessions].map(owner => owner.expoGo?.stopAsync())),
      ]);
      await Promise.allSettled([...deviceSessions].map(owner => owner.ready));
      await Promise.all(deviceRetirements);
      await launcherCachePriming.catch(() => {});
      await stopServicesAndDevicesAsync();
      const errors = [...unusedToolsResults, ...expoGoResults].flatMap(result =>
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
