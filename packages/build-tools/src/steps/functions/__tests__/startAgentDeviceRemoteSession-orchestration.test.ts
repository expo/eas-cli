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
import { createStartupTasks } from '../../utils/startupTasks';
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
    const logger = { info: jest.fn(), warn: jest.fn() };

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
    const logger = { info: jest.fn(), warn: jest.fn() };

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
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(
      runAsync(logger, BuildRuntimePlatform.LINUX, {
        launch_app_identifier: { value: 'host.exp.Exponent' },
      })
    ).rejects.toThrow('runs on linux');
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('starts the session host without waiting for the agent-device daemon', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
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
    const logger = { info: jest.fn(), warn: jest.fn() };
    jest
      .mocked(startDeviceSessionHostAsync)
      .mockRejectedValue(new Error('serve-sim did not start'));

    await expect(runAsync(logger, BuildRuntimePlatform.DARWIN)).rejects.toThrow(
      'serve-sim did not start'
    );

    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
    expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
  });

  it('stops the session host and the daemon when the daemon credentials never appear', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
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
    function deferred(): {
      promise: Promise<void>;
      resolve: () => void;
      reject: (e: Error) => void;
    } {
      let resolve!: () => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(() => {});
      return { promise, resolve, reject };
    }

    function startSession(device: { booted: Promise<unknown>; ready: Promise<unknown> }) {
      const logger = { info: jest.fn(), warn: jest.fn() } as never;
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
        tasks: createStartupTasks(logger),
        device,
      });
    }

    async function flushAsync(): Promise<void> {
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    it('starts the daemon during the boot and the session host after it', async () => {
      const booted = deferred();
      const session = startSession({ booted: booted.promise, ready: booted.promise });
      await flushAsync();

      expect(spawnDetached).toHaveBeenCalledTimes(1);
      expect(startNgrokTunnelAsync).toHaveBeenCalledTimes(1);
      expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();

      booted.resolve();
      await session;
      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
    });

    it('reports the session as ready only after the app is launched', async () => {
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(), ready: ready.promise });
      await flushAsync();

      expect(startDeviceSessionHostAsync).toHaveBeenCalledTimes(1);
      expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();

      ready.resolve();
      await session;
      expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
    });

    it('stops everything it started when the app install fails', async () => {
      const ready = deferred();
      const session = startSession({ booted: Promise.resolve(), ready: ready.promise });
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
