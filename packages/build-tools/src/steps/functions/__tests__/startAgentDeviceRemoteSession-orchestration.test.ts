import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { pollAgentDeviceArtifactsForUploadAsync } from '../../utils/agentDeviceArtifacts';
import { startAgentDeviceEventCollectionAsync } from '../../utils/agentDeviceEvents';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import {
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
  waitForFileAsync,
} from '../../utils/remoteDeviceRunSession';
import { type StartupTasks, createStartupTasks } from '../../utils/startupTasks';
import {
  createStartAgentDeviceRemoteSessionBuildFunction,
  runAgentDeviceRemoteSessionAsync,
} from '../startAgentDeviceRemoteSession';

// The daemon entry path and the state directory are resolved from the home directory when
// the module loads, so point it at a temp home we can populate.
jest.mock('node:os', () => {
  const actual = jest.requireActual('node:os');
  const actualPath = jest.requireActual('node:path');
  return {
    ...actual,
    homedir: () => actualPath.join(actual.tmpdir(), 'eas-agent-device-orchestration-home'),
  };
});
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../sentry');
jest.mock('../../utils/agentDeviceArtifacts', () => ({
  pollAgentDeviceArtifactsForUploadAsync: jest.fn(),
}));
jest.mock('../../utils/agentDeviceEvents', () => ({
  startAgentDeviceEventCollectionAsync: jest.fn(),
}));
jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  getDeviceRunSessionIdOrThrow: jest.fn(),
  getNgrokAuthtokenOrThrow: jest.fn(),
  getNgrokTunnelDomainOrThrow: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  spawnDetached: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  uploadRemoteSessionConfigAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
  waitForFileAsync: jest.fn(),
}));

const TEST_HOME = path.join(os.tmpdir(), 'eas-agent-device-orchestration-home');
const DAEMON_ENTRY_PATH = path.join(
  TEST_HOME,
  '.bun/install/global/node_modules/agent-device/dist/src/internal/daemon.js'
);

const ctx = {} as unknown as CustomBuildContext;
const mockPreviewStopAsync = jest.fn();
const mockTunnelStopAsync = jest.fn();
const mockDaemonStopAsync = jest.fn();
const mockEventCollectionStopAsync = jest.fn();

async function runAsync(
  logger: { info: jest.Mock; warn: jest.Mock },
  runtimePlatform: BuildRuntimePlatform,
  launchInputs: Record<string, { value: unknown }> = {}
): Promise<void> {
  const buildFunction = createStartAgentDeviceRemoteSessionBuildFunction(ctx);
  await buildFunction.fn!(
    { logger, global: { runtimePlatform } } as unknown as BuildStepContext,
    {
      inputs: {
        package_version: { value: undefined },
        max_idle_time_minutes: { value: undefined },
        max_duration_seconds: { value: undefined },
        ...launchInputs,
      },
      outputs: {},
      env: {},
    } as never
  );
}

describe('createStartAgentDeviceRemoteSessionBuildFunction orchestration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    jest.mocked(spawn).mockResolvedValue(undefined as never);
    jest.mocked(pollAgentDeviceArtifactsForUploadAsync).mockResolvedValue(undefined);
    jest.mocked(startAgentDeviceEventCollectionAsync).mockResolvedValue({
      stopAsync: mockEventCollectionStopAsync,
      getLastEventObservedAt: () => undefined,
    });
    jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('device-run-session-id');
    jest.mocked(getNgrokTunnelDomainOrThrow).mockReturnValue('tunnel.example.com');
    jest.mocked(getNgrokAuthtokenOrThrow).mockReturnValue('ngrok-token');
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockResolvedValue(undefined);
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 4242,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: mockDaemonStopAsync,
    });
    jest.mocked(waitForFileAsync).mockResolvedValue({ port: 5678, token: 'daemon-token' });
    jest.mocked(startNgrokTunnelAsync).mockResolvedValue({
      url: 'https://agent-device-abc.tunnel.example.com',
      subdomainId: 'agent-device-abc',
      stopAsync: mockTunnelStopAsync,
    });
    jest.mocked(startDeviceSessionHostAsync).mockResolvedValue({
      device: 'SIMULATOR-UDID',
      openPreviewAsync: jest.fn().mockResolvedValue({
        previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
        apiUrl: 'https://web-preview.tunnel.example.com',
        closeAsync: jest.fn(),
      }),
      finishAsync: mockPreviewStopAsync,
    });
    jest.mocked(uploadRemoteSessionConfigAsync).mockResolvedValue(undefined);
    jest.mocked(waitForDeviceRunSessionStoppedAsync).mockResolvedValue(undefined);

    await fs.promises.mkdir(path.dirname(DAEMON_ENTRY_PATH), { recursive: true });
    await fs.promises.writeFile(DAEMON_ENTRY_PATH, '');
  });

  afterEach(async () => {
    await fs.promises.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('reports the preview URL and tears every resource down', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };

    await runAsync(logger, BuildRuntimePlatform.LINUX);

    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ runtimePlatform: BuildRuntimePlatform.LINUX })
    );
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          agentDeviceRemoteSessionUrl: 'https://agent-device-abc.tunnel.example.com',
          agentDeviceRemoteSessionToken: 'daemon-token',
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://web-preview.tunnel.example.com',
        }),
      })
    );
    expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
    expect(mockEventCollectionStopAsync).toHaveBeenCalledTimes(1);
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
  });

  it('hands the launch inputs to serve-sim and announces them on an iOS session', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };

    await runAsync(logger, BuildRuntimePlatform.DARWIN, {
      launch_app_identifier: { value: 'host.exp.Exponent' },
      launch_args: { value: ['-EXDevMenuIsOnboardingFinished', '1'] },
      open_url: { value: 'exp://127.0.0.1:8081' },
    });

    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        launchAppIdentifier: 'host.exp.Exponent',
        launchArgs: ['-EXDevMenuIsOnboardingFinished', '1'],
        openUrl: 'exp://127.0.0.1:8081',
      })
    );
    expect(logger.info).toHaveBeenCalledWith(
      'serve-sim will launch host.exp.Exponent with arguments ' +
        '["-EXDevMenuIsOnboardingFinished","1"], then open exp://127.0.0.1:8081.'
    );
  });

  it('fails before starting the daemon when a launch is asked for on Android', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };

    await expect(
      runAsync(logger, BuildRuntimePlatform.LINUX, {
        launch_app_identifier: { value: 'host.exp.Exponent' },
      })
    ).rejects.toThrow('runs on linux');
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('starts the session host without waiting for the agent-device daemon', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
    const sessionHost = await jest.mocked(startDeviceSessionHostAsync).getMockImplementation()!(
      ctx,
      {} as never
    );
    let markHostStarted!: () => void;
    const hostStarted = new Promise<void>(resolve => {
      markHostStarted = resolve;
    });
    jest.mocked(startDeviceSessionHostAsync).mockImplementation(async () => {
      markHostStarted();
      return sessionHost;
    });
    // The daemon credentials only appear after the session host started. A sequential
    // startup would wait here forever.
    jest.mocked(waitForFileAsync).mockImplementation(async () => {
      await hostStarted;
      return { port: 5678, token: 'daemon-token' };
    });

    await runAsync(logger, BuildRuntimePlatform.DARWIN);

    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          agentDeviceRemoteSessionUrl: 'https://agent-device-abc.tunnel.example.com',
          agentDeviceRemoteSessionToken: 'daemon-token',
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
        }),
      })
    );
  });

  it('stops the daemon and its tunnel when the session host fails to start', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
    jest
      .mocked(startDeviceSessionHostAsync)
      .mockRejectedValue(new Error('serve-sim did not start'));

    await expect(runAsync(logger, BuildRuntimePlatform.DARWIN)).rejects.toThrow(
      'serve-sim did not start'
    );

    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    // The failure aborts the daemon task, which then may not start its daemon or tunnel.
    // Whatever started is stopped.
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(jest.mocked(spawnDetached).mock.calls.length);
    expect(mockTunnelStopAsync).toHaveBeenCalledTimes(
      jest.mocked(startNgrokTunnelAsync).mock.calls.length
    );
  });

  it('stops the session host and the daemon when the daemon credentials never appear', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
    jest.mocked(waitForFileAsync).mockRejectedValue(new Error('no daemon credentials'));

    await expect(runAsync(logger, BuildRuntimePlatform.DARWIN)).rejects.toThrow(
      'no daemon credentials'
    );

    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
  });

  describe('runAgentDeviceRemoteSessionAsync with a device that is still starting', () => {
    function deferred<T = void>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (e: Error) => void;
    } {
      let resolve!: (value: T) => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(() => {});
      return { promise, resolve, reject };
    }

    type Device = { booted: Promise<string | undefined>; ready: Promise<unknown> };
    function startSession(device: Device | ((tasks: StartupTasks) => Device)) {
      const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        child: jest.fn().mockReturnThis(),
      } as never;
      const tasks = createStartupTasks(logger);
      return runAgentDeviceRemoteSessionAsync(ctx, {
        env: {},
        logger,
        runtimePlatform: BuildRuntimePlatform.DARWIN,
        sessionEnv: {
          deviceRunSessionId: 'device-run-session-id',
          ngrokTunnelDomain: 'tunnel.example.com',
          ngrokAuthtoken: 'ngrok-token',
        },
        packageVersion: undefined,
        maxIdleTimeMinutes: undefined,
        maxDurationSeconds: undefined,
        launch: {},
        tasks,
        device: typeof device === 'function' ? device(tasks) : device,
      });
    }

    async function readDaemonPolicyAsync(): Promise<Record<string, unknown>> {
      const policyPath =
        jest.mocked(spawnDetached).mock.calls[0][0].env?.AGENT_DEVICE_DAEMON_POLICY;
      const policy = JSON.parse(await fs.promises.readFile(policyPath as string, 'utf8'));
      await fs.promises.rm(path.dirname(policyPath as string), { recursive: true, force: true });
      return policy;
    }

    async function flushAsync(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    it('installs agent-device during the boot and launches the daemon for the booted device', async () => {
      const booted = deferred<string | undefined>();
      const session = startSession({ booted: booted.promise, ready: booted.promise });
      await flushAsync();

      expect(spawn).toHaveBeenCalledWith('bun', ['add', 'agent-device@latest'], expect.anything());
      expect(spawnDetached).not.toHaveBeenCalled();
      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();

      booted.resolve('SIMULATOR-UDID');
      await session;
      expect(await readDaemonPolicyAsync()).toEqual({
        version: 1,
        devices: { allow: [{ udid: 'SIMULATOR-UDID' }] },
        commands: { deny: ['boot', 'shutdown'] },
        capabilities: { deny: ['device-shutdown'] },
      });
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
    });

    it('confines the daemon to the session host device when an earlier step booted it', async () => {
      const hostStarted = deferred<Awaited<ReturnType<typeof startDeviceSessionHostAsync>>>();
      jest.mocked(startDeviceSessionHostAsync).mockReturnValueOnce(hostStarted.promise);
      const session = startSession({
        booted: Promise.resolve(undefined),
        ready: Promise.resolve(),
      });
      await flushAsync();
      expect(spawnDetached).not.toHaveBeenCalled();

      hostStarted.resolve({
        device: 'EARLIER-STEP-UDID',
        openPreviewAsync: jest.fn().mockResolvedValue({
          previewPageUrl: 'https://expo.dev/simulator-preview/preview-id',
          apiUrl: 'https://web-preview.tunnel.example.com',
          closeAsync: jest.fn(),
        }),
        finishAsync: mockPreviewStopAsync,
      });
      await session;
      expect((await readDaemonPolicyAsync()).devices).toEqual({
        allow: [{ udid: 'EARLIER-STEP-UDID' }],
      });
    });

    it('fails when the session host serves another device than the session booted', async () => {
      await expect(
        startSession({ booted: Promise.resolve('BOOTED-UDID'), ready: Promise.resolve() })
      ).rejects.toThrow('serves device SIMULATOR-UDID, but the session booted BOOTED-UDID');
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    });

    it('names an Android device by its serial', async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
      await runAsync(logger, BuildRuntimePlatform.LINUX);
      expect((await readDaemonPolicyAsync()).devices).toEqual({
        allow: [{ serial: 'SIMULATOR-UDID' }],
      });
    });

    it('warns when the daemon does not enforce the policy', async () => {
      const logger = { info: jest.fn(), warn: jest.fn(), child: jest.fn().mockReturnThis() };
      await runAsync(logger, BuildRuntimePlatform.DARWIN);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('does not enforce daemon policies')
      );

      jest
        .mocked(waitForFileAsync)
        .mockResolvedValue({ port: 5678, token: 'daemon-token', policyDigest: 'digest' });
      const enforcedLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        child: jest.fn().mockReturnThis(),
      };
      await runAsync(enforcedLogger, BuildRuntimePlatform.DARWIN);
      expect(enforcedLogger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('does not enforce daemon policies')
      );
    });

    it('reports the session as ready only after the app is launched', async () => {
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(undefined), ready: ready.promise });
      await flushAsync();

      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();

      ready.resolve();
      await session;
      expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
    });

    it('stops waiting for the boot when the agent-device install fails', async () => {
      jest.mocked(spawn).mockRejectedValue(new Error('agent-device install failed'));
      const neverBooted = new Promise<string | undefined>(() => {});

      // In the combined step, `ready` stops waiting for the boot on an abort, like this.
      await expect(
        startSession(tasks => ({ booted: neverBooted, ready: tasks.untilAborted(neverBooted) }))
      ).rejects.toThrow('agent-device install failed');

      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
      expect(spawnDetached).not.toHaveBeenCalled();
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('stops the session host when the app fails while the daemon install hangs', async () => {
      jest.mocked(spawn).mockImplementation(((
        command: string,
        args: string[],
        options?: { signal?: AbortSignal }
      ) =>
        command === 'bun' && args[0] === 'add'
          ? new Promise((_resolve, reject) => {
              options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason));
            })
          : Promise.resolve(undefined)) as never);
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(undefined), ready: ready.promise });
      await flushAsync();
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);

      ready.reject(new Error('simctl install failed'));

      await expect(session).rejects.toThrow('simctl install failed');
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(spawnDetached).not.toHaveBeenCalled();
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    });

    it('stops everything it started when the app install fails', async () => {
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(undefined), ready: ready.promise });
      await flushAsync();
      ready.reject(new Error('simctl install failed'));

      await expect(session).rejects.toThrow('simctl install failed');
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
      expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
      expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('declares the launch inputs', () => {
    const buildFunction = createStartAgentDeviceRemoteSessionBuildFunction(ctx);
    const globalCtx = createGlobalContextMock();

    expect(
      buildFunction.inputProviders?.map(provider => provider(globalCtx, 'Test step').id)
    ).toEqual(expect.arrayContaining(['launch_app_identifier', 'launch_args', 'open_url']));
  });
});
