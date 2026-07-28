import { BuildRuntimePlatform, type BuildStepContext } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import { isProcessDescendantOfAsync } from '../../../utils/processes';
import { pollArgentArtifactsForUploadAsync } from '../../utils/argentArtifacts';
import { startArgentEventCollectionAsync } from '../../utils/argentEvents';
import {
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
jest.mock('../../utils/remoteDeviceRunSession', () => ({
  getDeviceRunSessionIdOrThrow: jest.fn(),
  getNgrokAuthtokenOrThrow: jest.fn(),
  getNgrokTunnelDomainOrThrow: jest.fn(),
  selectXcodeDeveloperDirectoryAsync: jest.fn(),
  spawnDetached: jest.fn(),
  startNgrokTunnelAsync: jest.fn(),
  startServeSimWithTunnelAsync: jest.fn(),
  uploadRemoteSessionConfigAsync: jest.fn(),
  waitForDeviceRunSessionStoppedAsync: jest.fn(),
}));

const TEST_HOME = path.join(os.tmpdir(), 'eas-argent-orchestration-home');
const ARGENT_STATE_DIR = path.join(TEST_HOME, '.argent');
const EXPECTED_EVENT_LOG_PATH = path.join(ARGENT_STATE_DIR, 'tool-server-events.jsonl');

const mockStopAsync = jest.fn();

describe('createStartArgentRemoteSessionBuildFunction orchestration', () => {
  beforeEach(async () => {
    jest.clearAllMocks();

    jest.mocked(spawn).mockResolvedValue(undefined as never);
    jest.mocked(isProcessDescendantOfAsync).mockResolvedValue(true);
    jest.mocked(pollArgentArtifactsForUploadAsync).mockResolvedValue(undefined);
    mockStopAsync.mockResolvedValue(undefined);
    jest.mocked(startArgentEventCollectionAsync).mockResolvedValue({ stopAsync: mockStopAsync });

    jest.mocked(getDeviceRunSessionIdOrThrow).mockReturnValue('device-run-session-id');
    jest.mocked(getNgrokTunnelDomainOrThrow).mockReturnValue('tunnel.example.com');
    jest.mocked(getNgrokAuthtokenOrThrow).mockReturnValue('ngrok-token');
    jest.mocked(selectXcodeDeveloperDirectoryAsync).mockResolvedValue(undefined);
    jest.mocked(spawnDetached).mockReturnValue({ pid: 4242, getOutput: () => '' });
    jest.mocked(startNgrokTunnelAsync).mockResolvedValue('https://argent-abc.tunnel.example.com');
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

  it('enables the event log flag, shares one path, and starts/stops the collector', async () => {
    const ctx = {} as unknown as CustomBuildContext;
    const buildFunction = createStartArgentRemoteSessionBuildFunction(ctx);

    await buildFunction.fn!(
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        global: { runtimePlatform: BuildRuntimePlatform.LINUX },
      } as unknown as BuildStepContext,
      {
        inputs: { package_version: { value: undefined } },
        outputs: {},
        env: { EXISTING: 'value' },
      } as never
    );

    // (1) The event log flag is enabled, before the tool-server is launched.
    const spawnCalls = jest.mocked(spawn).mock.calls;
    const enableEventLogIndex = spawnCalls.findIndex(
      ([command, args]) =>
        command === 'bunx' && Array.isArray(args) && args.includes('tool-server-event-log')
    );
    expect(enableEventLogIndex).toBeGreaterThanOrEqual(0);
    expect(jest.mocked(spawn).mock.invocationCallOrder[enableEventLogIndex]).toBeLessThan(
      jest.mocked(spawnDetached).mock.invocationCallOrder[0]
    );

    // (2) The tool-server and the collector are pinned to the exact same event log path.
    const serverEnv = jest.mocked(spawnDetached).mock.calls[0][0].env;
    expect(serverEnv.ARGENT_EVENT_LOG).toBe(EXPECTED_EVENT_LOG_PATH);
    expect(serverEnv.EXISTING).toBe('value');
    expect(jest.mocked(startArgentEventCollectionAsync).mock.calls[0][0]).toMatchObject({
      deviceRunSessionId: 'device-run-session-id',
      eventLogPath: EXPECTED_EVENT_LOG_PATH,
    });

    // (3) Collection starts (before we wait for the session to stop) and (4) is torn down
    // afterwards, exactly once.
    expect(startArgentEventCollectionAsync).toHaveBeenCalledTimes(1);
    expect(mockStopAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(startArgentEventCollectionAsync).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.invocationCallOrder[0]
    );
    expect(mockStopAsync.mock.invocationCallOrder[0]).toBeGreaterThan(
      jest.mocked(waitForDeviceRunSessionStoppedAsync).mock.invocationCallOrder[0]
    );
  });
});
