import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  DeviceRunSessionByIdQuery,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
} from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import { EAS_SIMULATOR_SESSION_ID, loadSimulatorEnvAsync } from '../../../simulator/env';
import {
  getServeSimDeviceUdidAsync,
  runServeSimHostActionAsync,
} from '../../../simulator/serveSimHost';
import SimulatorSimctl, { parseSimctlArgv } from '../simctl';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/serveSimHost', () => ({
  ...jest.requireActual('../../../simulator/serveSimHost'),
  getServeSimDeviceUdidAsync: jest.fn(),
  runServeSimHostActionAsync: jest.fn(),
}));

type DeviceRunSessionById = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];

const UDID = '5B3A2F1E-0C4D-4E8F-9A7B-1C2D3E4F5A6B';
const SPRINGBOARD_RESTART = [
  'spawn',
  'launchctl',
  'kickstart',
  '-k',
  'system/com.apple.SpringBoard',
];

const mockByIdAsync = jest.mocked(DeviceRunSessionQuery.byIdAsync);
const mockGetServeSimDeviceUdidAsync = jest.mocked(getServeSimDeviceUdidAsync);
const mockRunServeSimHostActionAsync = jest.mocked(runServeSimHostActionAsync);

function makeSession(overrides: Partial<DeviceRunSessionById> = {}): DeviceRunSessionById {
  return {
    id: 'session-123',
    status: DeviceRunSessionStatus.InProgress,
    type: DeviceRunSessionType.Argent,
    platform: AppPlatform.Ios,
    remoteConfig: {
      __typename: 'ArgentRunSessionRemoteConfig',
      toolsUrl: 'https://argent.example.com',
      previewApiUrl: 'https://preview.example.com',
      webPreviewToken: 'preview-token',
    },
    ...overrides,
  } as DeviceRunSessionById;
}

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({ failures: [], successes: [] });
  return config;
}

describe(parseSimctlArgv, () => {
  it('reads --id before the simctl arguments', () => {
    expect(parseSimctlArgv(['--id', 'session-1', 'ui', 'appearance', 'dark'])).toEqual({
      id: 'session-1',
      args: ['ui', 'appearance', 'dark'],
    });
    expect(parseSimctlArgv(['--id=session-1', ...SPRINGBOARD_RESTART])).toEqual({
      id: 'session-1',
      args: SPRINGBOARD_RESTART,
    });
  });

  it('passes simctl flags through untouched', () => {
    expect(parseSimctlArgv(SPRINGBOARD_RESTART)).toEqual({ args: SPRINGBOARD_RESTART });
    expect(parseSimctlArgv(['--', '--id', 'x'])).toEqual({ args: ['--id', 'x'] });
  });
});

describe(SimulatorSimctl, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[EAS_SIMULATOR_SESSION_ID];
    jest.mocked(loadSimulatorEnvAsync).mockResolvedValue();
    mockByIdAsync.mockResolvedValue(makeSession());
    mockGetServeSimDeviceUdidAsync.mockResolvedValue(UDID);
    mockRunServeSimHostActionAsync.mockResolvedValue({ stdout: '', stderr: '' });
  });

  function createCommand(argv: string[]): SimulatorSimctl {
    const command = new SimulatorSimctl(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir: '/test/project',
    });
    return command;
  }

  it('restarts SpringBoard on the session simulator', async () => {
    await createCommand(['--id', 'session-123', ...SPRINGBOARD_RESTART]).runAsync();

    expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-123');
    expect(mockRunServeSimHostActionAsync).toHaveBeenCalledWith(
      { apiUrl: 'https://preview.example.com', token: 'preview-token' },
      'springboard.restart',
      { udid: UDID }
    );
  });

  it('sets the appearance on the session from the env file', async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'session-123';

    await createCommand(['ui', 'appearance', 'dark']).runAsync();

    expect(mockRunServeSimHostActionAsync).toHaveBeenCalledWith(
      expect.anything(),
      'appearance.set',
      { value: 'dark', udid: UDID }
    );
  });

  it('rejects an unsupported command before fetching the session', async () => {
    await expect(
      createCommand(['--id', 'session-123', 'spawn', 'sh', '-c', 'id']).runAsync()
    ).rejects.toThrow('Unsupported simctl command: spawn sh -c id');
    expect(mockByIdAsync).not.toHaveBeenCalled();
  });

  it('rejects an Android session', async () => {
    mockByIdAsync.mockResolvedValue(makeSession({ platform: AppPlatform.Android }));

    await expect(
      createCommand(['--id', 'session-123', 'ui', 'appearance', 'dark']).runAsync()
    ).rejects.toThrow('only supports iOS');
    expect(mockRunServeSimHostActionAsync).not.toHaveBeenCalled();
  });

  it('rejects a session that is not running', async () => {
    mockByIdAsync.mockResolvedValue(makeSession({ status: DeviceRunSessionStatus.Stopped }));

    await expect(
      createCommand(['--id', 'session-123', 'ui', 'appearance', 'dark']).runAsync()
    ).rejects.toThrow('is stopped, not running');
  });
});
