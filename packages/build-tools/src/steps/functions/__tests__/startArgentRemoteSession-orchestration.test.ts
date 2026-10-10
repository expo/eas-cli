import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { type CustomBuildContext } from '../../../customBuildContext';
import { Sentry } from '../../../sentry';
import { IosSimulatorUtils } from '../../../utils/IosSimulatorUtils';
import { startDeviceSessionHostAsync } from '../../utils/deviceSessionHost';
import { isProcessDescendantOfAsync } from '../../../utils/processes';
import { pollArgentArtifactsForUploadAsync } from '../../utils/argentArtifacts';
import { startArgentEventCollectionAsync } from '../../utils/argentEvents';
import { createProcessOutput } from '../../utils/processOutput';
import {
  ensureFfmpegInstalledOnceAsync,
  getDeviceRunSessionIdOrThrow,
  getNgrokAuthtokenOrThrow,
  getNgrokTunnelDomainOrThrow,
  selectXcodeDeveloperDirectoryAsync,
  spawnDetached,
  startNgrokTunnelAsync,
  uploadRemoteSessionConfigAsync,
  waitForDeviceRunSessionStoppedAsync,
} from '../../utils/remoteDeviceRunSession';
import { createStartArgentRemoteSessionBuildFunction } from '../startArgentRemoteSession';
import { readIosApplicationIdentifierAsync } from '../../utils/serveSimActions';

// Redirect ~/.argent (where the tool-server writes its state file and event log) to a temp
// home so waitForArgentToolServerStateAsync — which lives in the module under test and cannot
// be mocked directly — can read a real state file we control.
jest.mock('node:os', () => {
  const actual = jest.requireActual('node:os');
  const actualPath = jest.requireActual('node:path');
  return {
    ...actual,
    homedir: () => actualPath.join(actual.tmpdir(), 'eas-argent-orchestration-home'),
  };
});
jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../../sentry');
jest.mock('../../../utils/processes', () => ({ isProcessDescendantOfAsync: jest.fn() }));
jest.mock('../../utils/argentArtifacts', () => ({ pollArgentArtifactsForUploadAsync: jest.fn() }));
jest.mock('../../utils/argentEvents', () => ({
  ...jest.requireActual('../../utils/argentEvents'),
  startArgentEventCollectionAsync: jest.fn(),
}));
jest.mock('../../utils/deviceSessionHost');
jest.mock('../../utils/serveSimActions', () => ({
  ...jest.requireActual('../../utils/serveSimActions'),
  readIosApplicationIdentifierAsync: jest.fn().mockResolvedValue('dev.example.app'),
}));
jest.mock('../../../utils/IosSimulatorUtils', () => ({
  IosSimulatorUtils: {
    resolveUdidAsync: jest.fn().mockResolvedValue('selected-ios-udid'),
    getAvailableDevicesAsync: jest
      .fn()
      .mockResolvedValue([{ name: 'iPhone 17', udid: 'selected-ios-udid' }]),
  },
}));
jest.mock('../../utils/localEgressGuard', () => ({
  resolveLocalEgressServeSimBootEnvironmentAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../utils/remoteDeviceRunSession', () => ({
  ...jest.requireActual('../../utils/remoteDeviceRunSession'),
  ensureFfmpegInstalledOnceAsync: jest.fn(),
  finishRemoteSessionAsync: jest.requireActual('../../utils/remoteDeviceRunSession')
    .finishRemoteSessionAsync,
  getDeviceRunSessionIdOrThrow: jest.fn(),
  getNgrokAuthtokenOrThrow: jest.fn(),
  getNgrokTunnelDomainOrThrow: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  spawnDetached: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  uploadRemoteSessionConfigAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));

const TEST_HOME = path.join(os.tmpdir(), 'eas-argent-orchestration-home');
const ARGENT_STATE_DIR = path.join(TEST_HOME, '.argent');
const EXPECTED_EVENT_LOG_PATH = path.join(ARGENT_STATE_DIR, 'tool-server-events.jsonl');

const mockStopAsync = jest.fn();
const mockTunnelStopAsync = jest.fn();
const mockPreviewStopAsync = jest.fn();

describe('createStartArgentRemoteSessionBuildFunction orchestration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    jest.mocked(spawn).mockResolvedValue(undefined as never);
    jest.mocked(isProcessDescendantOfAsync).mockResolvedValue(true);
    jest.mocked(pollArgentArtifactsForUploadAsync).mockResolvedValue(undefined);
    mockStopAsync.mockResolvedValue(undefined);
    mockTunnelStopAsync.mockResolvedValue(undefined);
    mockPreviewStopAsync.mockResolvedValue(undefined);
    jest.mocked(startArgentEventCollectionAsync).mockResolvedValue({
      stopAsync: mockStopAsync,
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
      stopAsync: jest.fn(),
    });
    jest.mocked(startNgrokTunnelAsync).mockResolvedValue({
      url: 'https://argent-abc.tunnel.example.com',
      subdomainId: 'argent-abc',
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

    // The (real) tool-server state wait reads this file from the redirected ~/.argent.
    await fs.promises.mkdir(ARGENT_STATE_DIR, { recursive: true });
    await fs.promises.writeFile(
      path.join(ARGENT_STATE_DIR, 'tool-server-orchestration.json'),
      JSON.stringify({ port: 5678, pid: 9999, token: 'tool-server-token' })
    );
  });

  afterEach(async () => {
    await fs.promises.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('reports an early exit with output and stops Argent before opening tunnels', async () => {
    const stopError = new Error('drain timed out');
    const stopServer = jest.fn().mockRejectedValue(stopError);
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 4242,
      getOutput: () => 'could not bind server port',
      getExitError: () => new Error('process exited with code 1'),
      stopAsync: stopServer,
    });
    const logger = { info: jest.fn(), warn: jest.fn() };
    const buildFunction = createStartArgentRemoteSessionBuildFunction({} as CustomBuildContext);
    await expect(
      buildFunction.fn!(
        {
          logger,
          global: { runtimePlatform: BuildRuntimePlatform.LINUX },
        } as unknown as BuildStepContext,
        {
          inputs: {
            package_version: { value: undefined },
            max_idle_time_minutes: { value: undefined },
          },
          outputs: {},
          env: {},
        } as never
      )
    ).rejects.toThrow(
      'Argent exited before becoming ready: process exited with code 1\nArgent tool-server output:\ncould not bind server port'
    );
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: stopError },
      'Could not stop the Argent tool-server during remote session teardown.'
    );
    expect(pollArgentArtifactsForUploadAsync).not.toHaveBeenCalled();
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
    expect(startArgentEventCollectionAsync).not.toHaveBeenCalled();
  });

  it('drains artifact polling and stops the tool-server when event collection cannot start', async () => {
    const collectionError = new Error('event collection failed');
    const stopError = new Error('drain timed out');
    let pollingFinished = false;
    jest
      .mocked(pollArgentArtifactsForUploadAsync)
      .mockImplementationOnce(async (_ctx, { signal }) => {
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
        pollingFinished = true;
      });
    jest.mocked(startArgentEventCollectionAsync).mockRejectedValueOnce(collectionError);
    const stopServer = jest.fn(async () => {
      expect(pollingFinished).toBe(true);
      throw stopError;
    });
    jest.mocked(spawnDetached).mockReturnValueOnce({
      pid: 4242,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopServer,
    });
    const logger = { info: jest.fn(), warn: jest.fn() };
    const buildFunction = createStartArgentRemoteSessionBuildFunction({} as CustomBuildContext);
    await expect(
      buildFunction.fn!(
        {
          logger,
          global: { runtimePlatform: BuildRuntimePlatform.LINUX },
        } as unknown as BuildStepContext,
        {
          inputs: {
            package_version: { value: undefined },
            max_idle_time_minutes: { value: undefined },
          },
          outputs: {},
          env: {},
        } as never
      )
    ).rejects.toBe(collectionError);
    expect(pollingFinished).toBe(true);
    expect(stopServer).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: stopError },
      'Could not stop the Argent tool-server during remote session teardown.'
    );
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    expect(startDeviceSessionHostAsync).not.toHaveBeenCalled();
  });

  it.each(['preview', 'config', 'wait'])(
    'finishes the host and tools after %s fails',
    async phase => {
      const error = new Error(`${phase} failed`);
      if (phase === 'preview') {
        jest.mocked(startDeviceSessionHostAsync).mockResolvedValueOnce({
          openPreviewAsync: jest.fn().mockRejectedValue(error),
          finishAsync: mockPreviewStopAsync,
        });
      } else if (phase === 'config') {
        jest.mocked(uploadRemoteSessionConfigAsync).mockRejectedValueOnce(error);
      } else {
        jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValueOnce(error);
      }
      const buildFunction = createStartArgentRemoteSessionBuildFunction({} as CustomBuildContext);
      await expect(
        buildFunction.fn!(
          {
            logger: { info: jest.fn(), warn: jest.fn() },
            global: { runtimePlatform: BuildRuntimePlatform.LINUX },
          } as unknown as BuildStepContext,
          {
            inputs: {
              package_version: { value: undefined },
              max_idle_time_minutes: { value: undefined },
            },
            outputs: {},
            env: {},
          } as never
        )
      ).rejects.toBe(error);
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
      expect(mockStopAsync).toHaveBeenCalledTimes(1);
      expect(jest.mocked(spawnDetached).mock.results[0].value.stopAsync).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['succeeded', false],
    ['failed', true],
  ])(
    'fails after stopping the host and tools when the tools tunnel cannot close and the session %s',
    async (_description, sessionFails) => {
      const closeError = new Error('ngrok close failed');
      const sessionError = new Error('session failed');
      mockTunnelStopAsync.mockRejectedValueOnce(closeError);
      if (sessionFails) {
        jest.mocked(waitForDeviceRunSessionStoppedAsync).mockRejectedValueOnce(sessionError);
      }
      const logger = { info: jest.fn(), warn: jest.fn() };
      const buildFunction = createStartArgentRemoteSessionBuildFunction({} as CustomBuildContext);
      // The tunnel may still be serving, so its failure fails a session that otherwise succeeded.
      await expect(
        buildFunction.fn!(
          {
            logger,
            global: { runtimePlatform: BuildRuntimePlatform.LINUX },
          } as unknown as BuildStepContext,
          {
            inputs: {
              package_version: { value: undefined },
              max_idle_time_minutes: { value: undefined },
            },
            outputs: {},
            env: {},
          } as never
        )
      ).rejects.toBe(sessionFails ? sessionError : closeError);
      expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(mockStopAsync).toHaveBeenCalledTimes(1);
      expect(jest.mocked(spawnDetached).mock.results[0].value.stopAsync).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        { err: closeError },
        'Could not stop the Argent tunnel during remote session teardown.'
      );
      expect(jest.mocked(Sentry.capture).mock.calls).toEqual(
        sessionFails
          ? [
              [
                'Could not stop the Argent tunnel after the remote session failed',
                closeError,
                { level: 'warning' },
              ],
            ]
          : []
      );
    }
  );

  it('enables the event log flag, shares one path, and starts/stops the collector', async () => {
    const ctx = {} as unknown as CustomBuildContext;
    const buildFunction = createStartArgentRemoteSessionBuildFunction(ctx);

    await buildFunction.fn!(
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        global: { runtimePlatform: BuildRuntimePlatform.LINUX },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
        },
        outputs: {},
        env: { EXISTING: 'value' },
      } as never
    );

    // (1) FFmpeg setup starts in the background before Argent setup.
    expect(ensureFfmpegInstalledOnceAsync).toHaveBeenCalledWith({
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: { EXISTING: 'value' },
      logger: expect.anything(),
    });
    expect(jest.mocked(ensureFfmpegInstalledOnceAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(spawn).mock.invocationCallOrder[0]
    );

    // (2) The event log flag is enabled, before the tool-server is launched.
    const spawnCalls = jest.mocked(spawn).mock.calls;
    const enableEventLogIndex = spawnCalls.findIndex(
      ([command, args]) =>
        command === 'bun' &&
        Array.isArray(args) &&
        args[0] === 'x' &&
        args.includes('tool-server-event-log')
    );
    expect(enableEventLogIndex).toBeGreaterThanOrEqual(0);
    expect(jest.mocked(spawn).mock.invocationCallOrder[enableEventLogIndex]).toBeLessThan(
      jest.mocked(spawnDetached).mock.invocationCallOrder[0]
    );

    // (3) The tool-server and the collector are pinned to the exact same event log path.
    const serverEnv = jest.mocked(spawnDetached).mock.calls[0][0].env;
    expect(serverEnv.ARGENT_EVENT_LOG).toBe(EXPECTED_EVENT_LOG_PATH);
    expect(serverEnv.ARGENT_EMULATOR_NO_WINDOW).toBe('1');
    expect(serverEnv.EXISTING).toBe('value');
    expect(jest.mocked(startArgentEventCollectionAsync).mock.calls[0][0]).toMatchObject({
      deviceRunSessionId: 'device-run-session-id',
      eventLogPath: EXPECTED_EVENT_LOG_PATH,
    });

    // (4) Collection starts (before we wait for the session to stop) and (5) is torn down
    // afterwards, exactly once.
    expect(startArgentEventCollectionAsync).toHaveBeenCalledTimes(1);
    expect(mockStopAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(startArgentEventCollectionAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.invocationCallOrder[0]
    );
    expect(mockStopAsync.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.invocationCallOrder[0]
    );
    expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ runtimePlatform: BuildRuntimePlatform.LINUX })
    );
    expect(uploadRemoteSessionConfigAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteConfig: expect.objectContaining({
          webPreviewUrl: 'https://expo.dev/simulator-preview/preview-id',
          previewApiUrl: 'https://web-preview.tunnel.example.com',
        }),
      })
    );
    expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
  });

  it('redacts startup credentials and registers the state token for later output', async () => {
    const token = 'tool/server "secret"';
    await fs.promises.writeFile(
      path.join(ARGENT_STATE_DIR, 'tool-server-orchestration.json'),
      JSON.stringify({ port: 5678, pid: 9999, token })
    );
    const logger = { info: jest.fn(), warn: jest.fn() };
    jest.mocked(spawnDetached).mockImplementationOnce(options => {
      const output = createProcessOutput(options.logger, options.secrets);
      output.stdout.append(`argent link argent://${encodeURIComponent(token)}@127.0.0.1:5678\n`);
      return {
        pid: 4242,
        getOutput: output.getOutput,
        getExitError: () => undefined,
        stopAsync: async () => {
          output.stderr.append(`opaque ${token}\nencoded ${encodeURIComponent(token)}\n`);
          output.stderr.append(`escaped ${JSON.stringify(token).slice(1, -1)}\n`);
          output.finish();
        },
      };
    });
    const buildFunction = createStartArgentRemoteSessionBuildFunction({} as CustomBuildContext);
    await buildFunction.fn!(
      {
        logger,
        global: { runtimePlatform: BuildRuntimePlatform.LINUX },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
        },
        outputs: {},
        env: {},
      } as never
    );
    expect(logger.info).toHaveBeenCalledWith(
      { source: 'stdout' },
      'argent link argent://[REDACTED]@127.0.0.1:5678'
    );
    for (const label of ['opaque', 'encoded', 'escaped']) {
      expect(logger.info).toHaveBeenCalledWith({ source: 'stderr' }, `${label} [REDACTED]`);
    }
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('secret');
  });

  it('hands the launch inputs to serve-sim and announces them on an iOS session', async () => {
    const ctx = {} as unknown as CustomBuildContext;
    const logger = { info: jest.fn(), warn: jest.fn() };
    const buildFunction = createStartArgentRemoteSessionBuildFunction(ctx);

    await buildFunction.fn!(
      {
        logger,
        global: { runtimePlatform: BuildRuntimePlatform.DARWIN },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
          max_duration_seconds: { value: undefined },
          launch_app_identifier: { value: 'host.exp.Exponent' },
          launch_args: { value: ['-EXDevMenuIsOnboardingFinished', '1'] },
          open_url: { value: 'exp://127.0.0.1:8081' },
        },
        outputs: {},
        env: { EXISTING: 'value' },
      } as never
    );

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

  it('boots and prepares the downloaded app while Argent installation is pending, and closes the host if installation fails', async () => {
    let rejectInstall!: (error: Error) => void;
    let enteredInstall!: () => void;
    const installEntered = new Promise<void>(resolve => {
      enteredInstall = resolve;
    });
    jest.mocked(spawn).mockImplementationOnce(() => {
      enteredInstall();
      return new Promise((_resolve, reject) => {
        rejectInstall = reject;
      }) as never;
    });
    const buildFunction = createStartArgentRemoteSessionBuildFunction({} as CustomBuildContext);
    const running = buildFunction.fn!(
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        global: { runtimePlatform: BuildRuntimePlatform.DARWIN },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
          device_identifier: { value: 'chosen-device' },
          install_app_path: { value: '/tmp/App.app' },
          launch_args: { value: ['--literal'] },
        },
        outputs: {},
        env: {},
      } as never
    );
    await installEntered;
    expect(
      jest.mocked(selectXcodeDeveloperDirectoryAsync).mock.invocationCallOrder[0]
    ).toBeLessThan(jest.mocked(IosSimulatorUtils.resolveUdidAsync).mock.invocationCallOrder[0]);
    expect(readIosApplicationIdentifierAsync).toHaveBeenCalledWith({
      artifactPath: '/tmp/App.app',
      env: {},
    });
    expect(startDeviceSessionHostAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        iosSimulatorUdid: 'SELECTED-IOS-UDID',
        installAppPath: '/tmp/App.app',
        launchAppIdentifier: 'dev.example.app',
        launchArgs: ['--literal'],
      })
    );
    const error = new Error('Argent install failed');
    rejectInstall(error);
    await expect(running).rejects.toBe(error);
    expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
    expect(uploadRemoteSessionConfigAsync).not.toHaveBeenCalled();
  });

  it('fails before starting anything when a launch is asked for on Android', async () => {
    const ctx = {} as unknown as CustomBuildContext;
    const logger = { info: jest.fn(), warn: jest.fn() };
    const buildFunction = createStartArgentRemoteSessionBuildFunction(ctx);

    await expect(
      buildFunction.fn!(
        {
          logger,
          global: { runtimePlatform: BuildRuntimePlatform.LINUX },
        } as unknown as BuildStepContext,
        {
          inputs: {
            package_version: { value: undefined },
            max_idle_time_minutes: { value: undefined },
            max_duration_seconds: { value: undefined },
            launch_app_identifier: { value: 'host.exp.Exponent' },
          },
          outputs: {},
          env: {},
        } as never
      )
    ).rejects.toThrow('runs on linux');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('declares the launch inputs', () => {
    const ctx = {} as unknown as CustomBuildContext;
    const buildFunction = createStartArgentRemoteSessionBuildFunction(ctx);
    const globalCtx = createGlobalContextMock();

    expect(
      buildFunction.inputProviders?.map(provider => provider(globalCtx, 'Test step').id)
    ).toEqual(expect.arrayContaining(['launch_app_identifier', 'launch_args', 'open_url']));
  });

  it('stops automation without waiting for recording upload', async () => {
    let release!: () => void;
    let stopped!: () => void;
    const pendingFinish = new Promise<void>(resolve => {
      release = resolve;
    });
    const toolStopped = new Promise<void>(resolve => {
      stopped = resolve;
    });
    mockPreviewStopAsync.mockReturnValueOnce(pendingFinish);
    const stopServer = jest.fn(async () => {
      stopped();
    });
    jest.mocked(spawnDetached).mockReturnValueOnce({
      pid: 4242,
      getOutput: () => '',
      getExitError: () => undefined,
      stopAsync: stopServer,
    });
    const buildFunction = createStartArgentRemoteSessionBuildFunction({} as CustomBuildContext);
    const running = buildFunction.fn!(
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        global: { runtimePlatform: BuildRuntimePlatform.LINUX },
      } as unknown as BuildStepContext,
      {
        inputs: {
          package_version: { value: undefined },
          max_idle_time_minutes: { value: undefined },
        },
        outputs: {},
        env: {},
      } as never
    );
    try {
      await toolStopped;
      expect(mockTunnelStopAsync).toHaveBeenCalledTimes(1);
      expect(mockPreviewStopAsync).toHaveBeenCalledTimes(1);
      expect(stopServer).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await running;
    }
  });
});
