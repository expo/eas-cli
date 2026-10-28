import { commands } from '../utils/processes';
import { startOwnedWrapperAsync } from './fixtures/ownedWrapper';

it('an early claim survives unused-tool wrapper exit while the selected server and Simulator stay owned', async () => {
  const fixture = await startOwnedWrapperAsync();
  const environment = { ...process.env };
  let session:
    | ReturnType<typeof import('../commands/start').createWarmSimulatorSession>
    | undefined;
  try {
    const { createWarmSimulatorSession } = await import('../commands/start');
    const simulator = await import('../utils/simulator');
    const serveSim = await import('../utils/serveSim');
    const processes = await import('../utils/processes');
    const agentDevice = await import('../utils/agentDevice');
    const argent = await import('../utils/argent');
    const expoGo = await import('../utils/expoGo');
    const controller = new AbortController();
    const running = commands.runAsync.bind(commands);
    process.env.EXPO_SIMULATOR_DEVICE = 'DUO';
    process.env.AGENT_DEVICE_STATE_DIR = '/owned-wrapper-fixture/agent';
    process.env.ARGENT_EVENT_LOG = '/owned-wrapper-fixture/argent-events';
    jest
      .spyOn(commands, 'runAsync')
      .mockImplementation((file, args, signal) =>
        file === 'bun' || (file === 'ps' && args[1] === String(process.pid))
          ? Promise.resolve('controller-start')
          : running(file, args, signal)
      );
    jest
      .spyOn(simulator, 'listAvailableSimulatorsAsync')
      .mockResolvedValue([{ udid: 'DUO', name: 'iPhone Duo' }]);
    jest.spyOn(simulator, 'disableApsdAsync').mockResolvedValue();
    const shutdown = jest.spyOn(simulator, 'shutdownSimulatorAsync').mockResolvedValue();
    const stopServer = jest.spyOn(processes, 'stopProcessAndDescendantsAsync').mockResolvedValue();
    jest.spyOn(agentDevice, 'createAgentDeviceTool').mockReturnValue({
      name: 'agent-device',
      startAsync: async () => {},
      stopAsync: fixture.stopAsync,
    });
    jest
      .spyOn(argent, 'createArgentTool')
      .mockReturnValue({ name: 'argent', startAsync: async () => {}, stopAsync: async () => {} });
    jest.spyOn(expoGo, 'startExpoGoPreinstall').mockReturnValue({
      preinstallOnDeviceAsync: async () => {},
      claimAsync: async () => undefined,
      stopAsync: async () => {},
    });
    jest.spyOn(serveSim, 'startServeSim').mockReturnValue({
      child: { pid: 90001 } as import('node:child_process').ChildProcess,
      resultPromise: new Promise(() => {}),
    });
    jest.spyOn(serveSim, 'waitForServeSimReadyAsync').mockResolvedValue({
      startupDevice: 'DUO',
      pid: 90001,
      nativeStartTime: 'fixture-start',
      port: 3200,
      url: 'http://127.0.0.1:3200',
      token: 'fixture-token',
    });
    const onFailure = jest.fn(error => controller.abort(error));
    session = createWarmSimulatorSession({
      signal: controller.signal,
      throwIfStoppingAsync: async () => controller.signal.throwIfAborted(),
      onPreparationFailure: onFailure,
    });
    await session.prepareAsync();
    expect(await session.claimAsync({ engine: 'serve-sim' })).toMatchObject({
      device: { udid: 'DUO' },
    });
    await session.prepareToolsAsync();
    await fixture.stopAsync();
    expect(fixture.job.child.exitCode).toBe(23);
    expect(onFailure).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
    expect(stopServer).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
    await session.stopAsync();
    expect(shutdown).toHaveBeenCalledWith('DUO');
  } finally {
    await session?.stopAsync().catch(() => {});
    jest.restoreAllMocks();
    process.env = environment;
    await fixture.cleanupAsync();
  }
}, 10_000);
