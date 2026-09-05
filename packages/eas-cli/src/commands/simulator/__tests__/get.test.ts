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
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../../simulator/env';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorGet from '../get';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
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
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockLoadSimulatorEnvironmentVariablesAsync = jest.mocked(loadSimulatorEnvAsync);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeDeviceRunSession(overrides: Partial<DeviceRunSessionById> = {}): DeviceRunSessionById {
  return {
    id: 'session-123',
    name: null,
    tags: [],
    status: DeviceRunSessionStatus.InProgress,
    type: DeviceRunSessionType.AgentDevice,
    platform: AppPlatform.Ios,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: '2025-01-01T00:00:05.000Z',
    finishedAt: null,
    updatedAt: '2025-01-01T00:01:00.000Z',
    app: {
      id: 'app-123',
      slug: 'testapp',
      ownerAccount: {
        id: 'account-123',
        name: 'testuser',
      },
    },
    artifacts: [
      {
        id: 'artifact-123',
        name: 'session-log',
        filename: 'session.log',
        downloadUrl: 'https://artifacts.example.com/session.log',
        fileSizeBytes: 1234,
        metadata: { kind: 'log' },
        createdAt: '2025-01-01T00:00:10.000Z',
        updatedAt: '2025-01-01T00:00:20.000Z',
      },
    ],
    remoteConfig: {
      __typename: 'AgentDeviceRunSessionRemoteConfig',
      agentDeviceRemoteSessionUrl: 'https://agent.example.com',
      agentDeviceRemoteSessionToken: 'token-123',
      webPreviewUrl: 'https://preview.example.com',
    },
    turtleJobRun: {
      id: 'job-123',
      status: JobRunStatus.InProgress,
    },
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

describe(SimulatorGet, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const projectDir = '/test/project';

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadSimulatorEnvironmentVariablesAsync.mockResolvedValue();
  });

  function createCommand(argv: string[]): {
    command: SimulatorGet;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new SimulatorGet(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir,
    });
    return { command, getContextAsync };
  }

  it('emits JSON when --json is passed', async () => {
    const session = makeDeviceRunSession({
      type: DeviceRunSessionType.ServeSim,
      remoteConfig: {
        __typename: 'ServeSimRunSessionRemoteConfig',
        previewUrl: 'https://web-preview-abc123.eas-simulator.ngrok.dev',
      },
    });
    mockByIdAsync.mockResolvedValue(session);

    const { command, getContextAsync } = createCommand(['--id', 'session-123', '--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(mockLoadSimulatorEnvironmentVariablesAsync).toHaveBeenCalledWith(projectDir);
    expect(getContextAsync).toHaveBeenCalledWith(SimulatorGet, {
      nonInteractive: true,
    });
    expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-123');
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      name: undefined,
      tags: [],
      type: 'web-preview-only',
      status: DeviceRunSessionStatus.InProgress,
      platform: AppPlatform.Ios,
      createdAt: '2025-01-01T00:00:00.000Z',
      startedAt: '2025-01-01T00:00:05.000Z',
      finishedAt: undefined,
      updatedAt: '2025-01-01T00:01:00.000Z',
      deviceRunSessionUrl:
        'https://expo.dev/accounts/testuser/projects/testapp/simulator-sessions/session-123',
      remoteConfig: {
        __typename: 'ServeSimRunSessionRemoteConfig',
        previewUrl: 'https://expo.dev/simulator-preview/abc123',
      },
      artifacts: session.artifacts,
    });
  });

  it('emits JSON with a null remote config when the session has none', async () => {
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession({ remoteConfig: null }));

    const { command } = createCommand(['--id', 'session-123', '--json']);
    await command.runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({ remoteConfig: null })
    );
  });

  it('fails the spinner when the session cannot be fetched', async () => {
    mockByIdAsync.mockRejectedValue(new Error('not found'));

    const { command } = createCommand(['--id', 'session-123']);
    await expect(command.runAsync()).rejects.toThrow('not found');
  });

  it('tells the user remote config is still coming when the session has none yet', async () => {
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession({ remoteConfig: null, artifacts: [] }));

    const { command } = createCommand(['--id', 'session-123']);
    await command.runAsync();

    expect(Log.log).toHaveBeenCalledWith(
      '⏳ Session is starting up — remote config is not available yet. Re-run this command in a moment.'
    );
  });

  it('prints artifacts that have no size or metadata', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({
        artifacts: [
          {
            id: 'artifact-123',
            name: 'session-log',
            filename: 'session.log',
            downloadUrl: 'https://artifacts.example.com/session.log',
            fileSizeBytes: null,
            metadata: null,
            createdAt: '2025-01-01T00:00:10.000Z',
            updatedAt: '2025-01-01T00:00:20.000Z',
          },
        ],
      })
    );

    const { command } = createCommand(['--id', 'session-123']);
    await command.runAsync();

    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('null'));
  });

  it('includes the session name in JSON and human output when the session is named', async () => {
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({ name: 'Checkout regression', tags: ['smoke'], startedAt: null })
    );

    const { command } = createCommand(['--id', 'session-123', '--json']);
    await command.runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Checkout regression' })
    );

    jest.clearAllMocks();
    mockLoadSimulatorEnvironmentVariablesAsync.mockResolvedValue();
    mockByIdAsync.mockResolvedValue(
      makeDeviceRunSession({ name: 'Checkout regression', tags: ['smoke'], startedAt: null })
    );

    const { command: humanCommand } = createCommand(['--id', 'session-123']);
    await humanCommand.runAsync();

    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Checkout regression'));
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('smoke'));
  });

  it(`uses ${EAS_SIMULATOR_SESSION_ID} from simulator env when --id is not passed`, async () => {
    const previousDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];
    const session = makeDeviceRunSession({ id: 'session-from-env' });
    mockByIdAsync.mockResolvedValue(session);
    process.env[EAS_SIMULATOR_SESSION_ID] = 'session-from-env';

    try {
      const { command } = createCommand([]);
      await command.runAsync();

      expect(mockLoadSimulatorEnvironmentVariablesAsync).toHaveBeenCalledWith(projectDir);
      expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-from-env');
    } finally {
      if (previousDeviceRunSessionId === undefined) {
        delete process.env[EAS_SIMULATOR_SESSION_ID];
      } else {
        process.env[EAS_SIMULATOR_SESSION_ID] = previousDeviceRunSessionId;
      }
    }
  });

  it('throws a helpful error when no simulator session ID is available', async () => {
    const previousDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];
    delete process.env[EAS_SIMULATOR_SESSION_ID];

    try {
      const { command } = createCommand([]);

      await expect(command.runAsync()).rejects.toThrow(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
      expect(mockLoadSimulatorEnvironmentVariablesAsync).toHaveBeenCalledWith(projectDir);
      expect(mockByIdAsync).not.toHaveBeenCalled();
    } finally {
      if (previousDeviceRunSessionId === undefined) {
        delete process.env[EAS_SIMULATOR_SESSION_ID];
      } else {
        process.env[EAS_SIMULATOR_SESSION_ID] = previousDeviceRunSessionId;
      }
    }
  });
});
