import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createServer } from 'node:http';
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
jest.unmock('node-fetch');
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

// Stands in for the daemon's HTTP server, so the step can probe GET /health.
let daemonServer: ReturnType<typeof createServer>;
let daemonHealthRequestCount: number;

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

    daemonHealthRequestCount = 0;
    daemonServer = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/health') {
        daemonHealthRequestCount += 1;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ok: true, service: 'agent-device-daemon' }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>(resolve => daemonServer.listen(0, '127.0.0.1', resolve));
    const daemonPort = (daemonServer.address() as AddressInfo).port;

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
    jest.mocked(waitForFileAsync).mockResolvedValue({ port: daemonPort, token: 'daemon-token' });
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
    await new Promise<void>(resolve => daemonServer.close(() => resolve()));
    await fs.promises.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('reports the preview URL and tears every resource down', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await runAsync(logger, BuildRuntimePlatform.LINUX);

    expect(selectXcodeDeveloperDirectoryAsync).not.toHaveBeenCalled();
    expect(daemonHealthRequestCount).toBe(1);
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

  it('fails before opening the tunnel when the daemon has already exited', async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    jest.mocked(spawnDetached).mockReturnValue({
      pid: 4242,
      getOutput: () => 'daemon crashed',
      getExitError: () => new Error('Process exited with code 1.'),
      stopAsync: mockDaemonStopAsync,
    });

    await expect(runAsync(logger, BuildRuntimePlatform.LINUX)).rejects.toThrow(
      /did not answer health checks on port \d+ \(daemon process exited: Process exited with code 1\.\)\.\nagent-device daemon output:\ndaemon crashed$/
    );
    expect(daemonHealthRequestCount).toBe(0);
    expect(startNgrokTunnelAsync).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Daemon is listening on port')
    );
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

  it('declares the launch inputs', () => {
    const buildFunction = createStartAgentDeviceRemoteSessionBuildFunction(ctx);
    const globalCtx = createGlobalContextMock();

    expect(
      buildFunction.inputProviders?.map(provider => provider(globalCtx, 'Test step').id)
    ).toEqual(expect.arrayContaining(['launch_app_identifier', 'launch_args', 'open_url']));
  });
});
