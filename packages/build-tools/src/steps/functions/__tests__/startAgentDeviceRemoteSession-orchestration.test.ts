import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { pollAgentDeviceArtifactsForUploadAsync } from '../../utils/agentDeviceArtifacts';
import { startAgentDeviceEventCollectionAsync } from '../../utils/agentDeviceEvents';
import { warmUpAgentDeviceIosRunnerAsync } from '../../utils/agentDeviceRunnerWarmup';
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
import { createStartAgentDeviceRemoteSessionBuildFunction } from '../startAgentDeviceRemoteSession';

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
jest.mock('../../utils/agentDeviceRunnerWarmup', () => ({
  warmUpAgentDeviceIosRunnerAsync: jest.fn(),
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
    jest.mocked(warmUpAgentDeviceIosRunnerAsync).mockResolvedValue(undefined);
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

  it('does not warm up the iOS runner by default', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await runAsync(logger, BuildRuntimePlatform.DARWIN);

    expect(warmUpAgentDeviceIosRunnerAsync).not.toHaveBeenCalled();
  });

  it('warms up the iOS runner in the session daemon when prepare_ios_runner is set', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await runAsync(logger, BuildRuntimePlatform.DARWIN, {
      prepare_ios_runner: { value: true },
    });

    expect(warmUpAgentDeviceIosRunnerAsync).toHaveBeenCalledWith({
      daemonUrl: 'http://127.0.0.1:5678',
      daemonToken: 'daemon-token',
      logger,
    });
    // It starts before the tunnels, so it runs in parallel with them.
    expect(jest.mocked(warmUpAgentDeviceIosRunnerAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(startNgrokTunnelAsync).mock.invocationCallOrder[0]
    );
  });

  it('reports the session as ready without waiting for the iOS runner warm-up', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    jest.mocked(warmUpAgentDeviceIosRunnerAsync).mockReturnValue(new Promise(() => {}));

    await runAsync(logger, BuildRuntimePlatform.DARWIN, {
      prepare_ios_runner: { value: true },
    });

    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledTimes(1);
    expect(mockDaemonStopAsync).toHaveBeenCalledTimes(1);
  });

  it('does not warm up an iOS runner on an Android session', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await runAsync(logger, BuildRuntimePlatform.LINUX, {
      prepare_ios_runner: { value: true },
    });

    expect(warmUpAgentDeviceIosRunnerAsync).not.toHaveBeenCalled();
  });

  it('declares the launch inputs', () => {
    const buildFunction = createStartAgentDeviceRemoteSessionBuildFunction(ctx);
    const globalCtx = createGlobalContextMock();

    expect(
      buildFunction.inputProviders?.map(provider => provider(globalCtx, 'Test step').id)
    ).toEqual(
      expect.arrayContaining([
        'launch_app_identifier',
        'launch_args',
        'open_url',
        'prepare_ios_runner',
      ])
    );
  });
});
