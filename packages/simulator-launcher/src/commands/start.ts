import { once } from 'node:events';
import { setTimeout as sleepAsync } from 'node:timers/promises';

import { createAgentDeviceTool } from '../utils/agentDevice';
import { createArgentTool } from '../utils/argent';
import {
  type ChildProcessHandle,
  commands,
  stopProcessAndDescendantsAsync,
} from '../utils/processes';
import { startServeSim, waitForServeSimReadyAsync } from '../utils/serveSim';
import {
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
  readLauncherStateAsync,
  updateLauncherStateAsync,
} from '../utils/state';
import { type StartedTool, type WarmTool, startTool } from '../utils/tools';

const LAUNCHER_VERSION: string = require('../../package.json').version;

type WarmSimulatorSession = {
  prepareAsync(): Promise<WarmSessionInfo>;
  claimAsync(request: ClaimInput): Promise<{ device: SimulatorDevice }>;
  prepareToolsAsync(): Promise<void>;
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
    if (state?.status === 'stopping' || state?.status === 'disabled') {
      requestShutdown();
    }
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
    requireOwnedState(await readLauncherStateAsync(bootUuid));
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
        process.stderr.write('EXPO_SIMULATOR_STARTUP is not 1; Simulator warmup is disabled.\n');
        requestShutdown();
      }
      await prepareDefaultDeviceAsync();
      await handleOneClaimAsync();
      while (!signal.aborted) {
        const state = requireOwnedState(await readLauncherStateAsync(bootUuid), 'claimed');
        if (state.prepareToolsRequested && !state.toolsReady) {
          await session.prepareToolsAsync();
          await updateLauncherStateAsync(
            bootUuid,
            current => ({
              ...requireOwnedState(current, 'claimed'),
              toolsReady: true,
            }),
            signal
          );
          break;
        }
        await sleepAsync(100, undefined, { signal });
      }
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

/** Own one orphan process and its tool/preinstall work before any preparation awaits. */
export function createWarmSimulatorSession({
  signal: parentSignal,
  throwIfStoppingAsync,
  onPreparationFailure,
}: {
  signal: AbortSignal;
  throwIfStoppingAsync(): Promise<void>;
  onPreparationFailure(error: unknown): void;
}): WarmSimulatorSession {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([parentSignal, lifetime.signal]);
  const warmTools = [createAgentDeviceTool(), createArgentTool(onPreparationFailure)];
  const startedTools = new Map<WarmTool, StartedTool>();
  const ownedDevices = new Set<string>();
  const simulatorSetup: Promise<void>[] = [];
  const setupFinished = new Set<string>();
  let preparation: Promise<WarmSessionInfo> | undefined;
  let server: ChildProcessHandle | undefined;
  let info: WarmSessionInfo;
  let availableDevices: SimulatorDevice[];
  let warmDevices: SimulatorDevice[] = [];
  let request: ClaimInput | undefined;
  let stopping = false;
  let launcherCachePriming: Promise<void> = Promise.resolve();
  let toolRetirement: Promise<PromiseSettledResult<void>[]> = Promise.resolve([]);

  function startSimulatorSetup(
    udid: string,
    ready: Promise<unknown>,
    setupSignal: AbortSignal
  ): Promise<void> {
    const setup = ready.then(async () => {
      setupSignal.throwIfAborted();
      await disableApsdAsync(udid, setupSignal).catch(error => {
        setupSignal.throwIfAborted();
        process.stderr.write(`Could not disable apsd on ${udid}; continuing: ${error}\n`);
      });
      setupFinished.add(udid);
    });
    simulatorSetup.push(setup);
    return setup;
  }

  async function resolveDeviceAsync(selector: string): Promise<SimulatorDevice> {
    for (let attempt = 0; ; attempt++) {
      const matches = selectSimulators(availableDevices, selector);
      if (matches.length === 1) {
        return matches[0];
      }
      if (matches.length > 1 || attempt === 1) {
        throw new Error(
          `Could not select one available Simulator for ${selector}. Use an exact available device name or UDID.`
        );
      }
      await throwIfStoppingAsync();
      availableDevices = await listAvailableSimulatorsAsync(signal);
    }
  }

  async function primeLauncherCacheAsync(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await commands.runAsync(
          'bun',
          ['x', `@expo/simulator-launcher@${LAUNCHER_VERSION}`, '--version'],
          AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        );
        return;
      } catch (error) {
        signal.throwIfAborted();
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
    const selected = selectSimulators(
      availableDevices,
      process.env.EXPO_SIMULATOR_DEVICE?.trim() || undefined
    );
    if (selected.length !== 1) {
      throw new Error(
        'Could not select one available Simulator. Use an exact device name or UDID.'
      );
    }
    warmDevices = selected;
    const controllerStartTime = (
      await commands.runAsync('ps', ['-p', String(process.pid), '-o', 'lstart='], signal)
    ).trim();
    signal.throwIfAborted();
    if (!controllerStartTime) {
      throw new Error(
        'Could not read the Simulator launcher process start time; the warm session cannot be verified.'
      );
    }
    const first = warmDevices[0];
    // serve-sim owns all boot/selection work, including partial boots during failed adoption.
    server = startServeSim(
      warmDevices.map(device => device.udid),
      signal
    );
    for (const device of warmDevices) {
      ownedDevices.add(device.udid);
    }
    const ready = waitForServeSimReadyAsync(first.udid, server, signal);
    void ready.catch(() => {});
    for (const tool of warmTools) {
      startedTools.set(tool, startTool(tool, first.udid, ready, signal, onPreparationFailure));
    }
    const apsd = startSimulatorSetup(first.udid, ready, signal);
    launcherCachePriming = primeLauncherCacheAsync();
    const [serverInfo] = await Promise.all([ready, apsd, launcherCachePriming]);
    info = {
      device: first,
      server: serverInfo,
      controllerPid: process.pid,
      controllerStartTime,
      agentDeviceStateDir: process.env.AGENT_DEVICE_STATE_DIR!,
      argentEventLogPath: process.env.ARGENT_EVENT_LOG!,
    };
    return info;
  }

  return {
    async prepareAsync() {
      return await (preparation ??= prepareDefaultAsync());
    },
    async claimAsync(input) {
      if (request || stopping) {
        throw new Error('This warm Simulator session has already been claimed or is stopping.');
      }
      request = input;
      await throwIfStoppingAsync();
      const selected = input.requestedDevice
        ? await resolveDeviceAsync(input.requestedDevice)
        : warmDevices[0];
      ownedDevices.add(selected.udid);
      const requestedTool = warmTools.find(tool => tool.name === input.engine);
      const sameDevice = selected.udid === warmDevices[0].udid;
      toolRetirement = Promise.allSettled(
        [...startedTools]
          .filter(
            ([tool]) => tool !== requestedTool || (tool.name === 'agent-device' && !sameDevice)
          )
          .map(([tool, started]) => {
            startedTools.delete(tool);
            // The job owns the device now; the terminal stop retries this tool.
            return started.stopAsync().catch(error => {
              process.stderr.write(`Could not stop ${tool.name}; retrying at stop: ${error}\n`);
              throw error;
            });
          })
      );
      // Adoption can release an old device; join cancelled launchctl commands before it does.
      await Promise.allSettled(simulatorSetup);
      info = { ...info, device: selected };
      return { device: selected };
    },
    async prepareToolsAsync() {
      if (!request || stopping) {
        throw new Error('Claim a warm Simulator session before preparing its tools.');
      }
      // This phase cannot start a runner against the old device before private adoption finishes.
      const adopted = await waitForServeSimReadyAsync(
        info.device.udid,
        server!,
        signal,
        info.server.port
      );
      if (
        adopted.pid !== info.server.pid ||
        adopted.nativeStartTime !== info.server.nativeStartTime ||
        adopted.url !== info.server.url ||
        adopted.token !== info.server.token
      ) {
        throw new Error('The adopted serve-sim process does not match the claimed warm server.');
      }
      if (!setupFinished.has(info.device.udid)) {
        // A replacement or cancelled secondary can miss warmup setup. Keep this optional work
        // nonblocking for tools/app actions, but owned and joined before device teardown.
        void startSimulatorSetup(info.device.udid, Promise.resolve(), signal).catch(() => {});
      }
      const tool = warmTools.find(tool => tool.name === request!.engine);
      if (tool?.name === 'agent-device' && !startedTools.has(tool)) {
        const results = await toolRetirement;
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') {
          throw failed.reason;
        }
      }
      await throwIfStoppingAsync();
      if (tool && !startedTools.has(tool)) {
        startedTools.set(
          tool,
          startTool(tool, info.device.udid, Promise.resolve(), signal, onPreparationFailure)
        );
      }
      if (tool) {
        await startedTools.get(tool)!.ready;
      }
    },
    async stopAsync() {
      stopping = true;
      const cancellations = [...startedTools.values()].map(tool => tool.cancelAsync());
      lifetime.abort();
      await Promise.allSettled(cancellations);
      await preparation?.catch(() => {});
      await Promise.allSettled(simulatorSetup);
      await toolRetirement;
      await launcherCachePriming.catch(() => {});
      const errors: unknown[] = [];
      const attemptAsync = async (operation: Promise<void>) => {
        await operation.catch(error => errors.push(error));
      };
      // Keep handles after failure so terminal cleanup never mistakes wrapper exit for drain.
      for (const started of startedTools.values()) {
        await attemptAsync(started.stopAsync());
      }
      for (const tool of warmTools) {
        if (!startedTools.has(tool) && server) {
          await attemptAsync(tool.stopAsync());
        }
      }
      if (server) {
        await attemptAsync(
          stopProcessAndDescendantsAsync(server).then(() => {
            server = undefined;
          })
        );
      }
      await Promise.all(
        [...ownedDevices].map(udid =>
          attemptAsync(
            shutdownSimulatorAsync(udid).then(() => {
              ownedDevices.delete(udid);
            })
          )
        )
      );
      try {
        commands.throwIfCommandCloseTimedOut();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) {
        throw new AggregateError(
          errors,
          'Warm Simulator cleanup could not be confirmed; services or devices may still be running.'
        );
      }
    },
  };
}
