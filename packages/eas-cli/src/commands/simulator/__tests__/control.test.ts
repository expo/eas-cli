import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  DeviceRunSessionByIdQuery,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  JobRunStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../../log';
import { loadSimulatorEnvAsync } from '../../../simulator/env';
import { runHostActionAsync } from '../../../simulator/hostActions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorControl from '../control';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
}));
jest.mock('../../../simulator/hostActions', () => ({
  ...jest.requireActual('../../../simulator/hostActions'),
  runHostActionAsync: jest.fn(),
}));
jest.mock('../../../ora', () => ({
  ora: jest.fn(() => {
    const spinner = {
      fail: jest.fn(),
      start: jest.fn(),
      succeed: jest.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));
jest.mock('../../../utils/json');

type DeviceRunSessionById = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];

const mockByIdAsync = jest.mocked(DeviceRunSessionQuery.byIdAsync);
const mockRunHostActionAsync = jest.mocked(runHostActionAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeDeviceRunSession(overrides: Partial<DeviceRunSessionById> = {}): DeviceRunSessionById {
  return {
    id: 'session-123',
    name: null,
    tags: [],
    status: DeviceRunSessionStatus.InProgress,
    type: DeviceRunSessionType.WebPreviewOnly,
    platform: AppPlatform.Ios,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: '2025-01-01T00:00:05.000Z',
    finishedAt: null,
    updatedAt: '2025-01-01T00:01:00.000Z',
    app: {
      id: 'app-123',
      slug: 'testapp',
      ownerAccount: { id: 'account-123', name: 'testuser' },
    },
    artifacts: [],
    remoteConfig: {
      __typename: 'WebPreviewOnlyRunSessionRemoteConfig',
      previewUrl: 'https://expo.dev/preview',
      previewToken: 'preview-token',
      previewApiUrl: 'https://sim.example.test',
    },
    turtleJobRun: { id: 'job-123', status: JobRunStatus.InProgress },
    ...overrides,
  };
}

function getMockOclifConfig(): Config {
  const config = new Config({ root: __dirname });
  config.runHook = async () => ({
    failures: [],
    successes: [],
  });
  return config;
}

describe(SimulatorControl, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(loadSimulatorEnvAsync).mockResolvedValue();
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession());
    mockRunHostActionAsync.mockResolvedValue({ stdout: 'off\n', stderr: '', exitCode: 0 });
  });

  function createCommand(argv: string[]): SimulatorControl {
    const command = new SimulatorControl(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir,
    });
    return command;
  }

  it('sets a value on the session preview server and prints the output', async () => {
    await createCommand(['hardware-keyboard', 'off', '--id', 'session-123']).runAsync();

    expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-123');
    expect(mockRunHostActionAsync).toHaveBeenCalledWith(
      { apiUrl: 'https://sim.example.test', token: 'preview-token' },
      { action: 'hardwareKeyboard.set', params: { value: 'off' } }
    );
    expect(jest.mocked(Log.log)).toHaveBeenCalledWith('off');
  });

  it('prints parsed JSON for a listing', async () => {
    mockRunHostActionAsync.mockResolvedValue({
      stdout: '{"voiceover":"off"}\n',
      stderr: '',
      exitCode: 0,
    });

    await createCommand(['settings', '--id', 'session-123', '--json']).runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      action: 'settings',
      output: { voiceover: 'off' },
    });
  });

  it('passes the bundle identifier through', async () => {
    await createCommand([
      'permissions',
      'list',
      'com.example.app',
      '--id',
      'session-123',
    ]).runAsync();

    expect(mockRunHostActionAsync).toHaveBeenCalledWith(expect.anything(), {
      action: 'permissions.list',
      params: { bundleId: 'com.example.app' },
    });
  });

  it('refuses a wrong action before it loads the session', async () => {
    await expect(createCommand(['server-kill', '--id', 'session-123']).runAsync()).rejects.toThrow(
      'Unknown simulator action "server-kill"'
    );
    expect(mockByIdAsync).not.toHaveBeenCalled();
  });

  it('refuses a session that is not running', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({ status: DeviceRunSessionStatus.Stopped })
    );

    await expect(
      createCommand(['memory-warning', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('Simulator session session-123 is stopped');
    expect(mockRunHostActionAsync).not.toHaveBeenCalled();
  });

  it('refuses an Android session', async () => {
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession({ platform: AppPlatform.Android }));

    await expect(
      createCommand(['memory-warning', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('available only for iOS sessions');
    expect(mockRunHostActionAsync).not.toHaveBeenCalled();
  });

  it('refuses a session without a preview server API', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({
        remoteConfig: {
          __typename: 'ServeSimRunSessionRemoteConfig',
          previewUrl: 'https://sim.example.test',
          previewToken: 'preview-token',
        },
      })
    );

    await expect(
      createCommand(['memory-warning', '--id', 'session-123']).runAsync()
    ).rejects.toThrow('does not expose a preview server');
  });

  it('reports the simulator error when the action fails', async () => {
    mockRunHostActionAsync.mockResolvedValue({
      stdout: '',
      stderr: 'No serve-sim server running.\n',
      exitCode: 1,
    });

    await expect(createCommand(['permissions', '--id', 'session-123']).runAsync()).rejects.toThrow(
      'The simulator could not run permissions: No serve-sim server running.'
    );
  });
});
