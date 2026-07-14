import { Config } from '@oclif/core';
import * as fs from 'fs-extra';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  CreateDeviceRunSessionMutation,
  DeviceRunSessionByIdQuery,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  JobRunStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionMutation } from '../../../graphql/mutations/DeviceRunSessionMutation';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_HEADER,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
  resetSimulatorEnvAsync,
} from '../../../simulator/env';
import SimulatorStart from '../start';

jest.mock('fs-extra');
jest.mock('../../../graphql/mutations/DeviceRunSessionMutation');
jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    log: jest.fn(),
    newLine: jest.fn(),
    warn: jest.fn(),
    withTick: jest.fn(),
  },
  link: jest.fn((url: string) => url),
}));
jest.mock('../../../simulator/env', () => ({
  ...jest.requireActual('../../../simulator/env'),
  loadSimulatorEnvAsync: jest.fn(),
  resetSimulatorEnvAsync: jest.fn(),
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

type CreatedDeviceRunSession =
  CreateDeviceRunSessionMutation['deviceRunSession']['createDeviceRunSession'];
type DeviceRunSessionById = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];

const graphqlClient = {} as ExpoGraphqlClient;
const projectDir = '/test/project';
const simulatorDotenvPath = `${projectDir}/.env.eas-simulator`;
const deviceRunSessionUrl =
  'https://expo.dev/accounts/testuser/projects/testapp/simulator-sessions/session-123';

const mockCreateDeviceRunSessionAsync = jest.mocked(
  DeviceRunSessionMutation.createDeviceRunSessionAsync
);
const mockByIdAsync = jest.mocked(DeviceRunSessionQuery.byIdAsync);
const mockLoadSimulatorEnvAsync = jest.mocked(loadSimulatorEnvAsync);
const mockResetSimulatorEnvAsync = jest.mocked(resetSimulatorEnvAsync);
const mockOra = jest.mocked(ora);

function makeCreatedDeviceRunSession(
  overrides: Partial<CreatedDeviceRunSession> = {}
): CreatedDeviceRunSession {
  return {
    id: 'session-123',
    status: DeviceRunSessionStatus.InProgress,
    app: {
      id: 'app-123',
      slug: 'testapp',
      ownerAccount: {
        id: 'account-123',
        name: 'testuser',
      },
    },
    turtleJobRun: {
      id: 'job-123',
    },
    ...overrides,
  };
}

function makeDeviceRunSession(overrides: Partial<DeviceRunSessionById> = {}): DeviceRunSessionById {
  return {
    id: 'session-123',
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
    artifacts: [],
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

describe(SimulatorStart, () => {
  const mockConfig = getMockOclifConfig();
  const previousDeviceRunSessionId = process.env[EAS_SIMULATOR_SESSION_ID];

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env[EAS_SIMULATOR_SESSION_ID];
    mockCreateDeviceRunSessionAsync.mockResolvedValue(makeCreatedDeviceRunSession());
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession());
    mockLoadSimulatorEnvAsync.mockResolvedValue();
    mockResetSimulatorEnvAsync.mockResolvedValue();
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
  });

  afterAll(() => {
    if (previousDeviceRunSessionId === undefined) {
      delete process.env[EAS_SIMULATOR_SESSION_ID];
    } else {
      process.env[EAS_SIMULATOR_SESSION_ID] = previousDeviceRunSessionId;
    }
  });

  function createCommand(argv: string[]): {
    command: SimulatorStart;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new SimulatorStart(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
      projectDir,
      projectId: 'project-123',
    });
    return { command, getContextAsync };
  }

  it('prints environment variables without saving when outputting env', async () => {
    const { command, getContextAsync } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--out-config-type',
      'env',
    ]);
    await command.runAsync();

    expect(getContextAsync).toHaveBeenCalledWith(SimulatorStart, {
      nonInteractive: true,
    });
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      packageVersion: undefined,
      platform: AppPlatform.Ios,
      type: DeviceRunSessionType.AgentDevice,
    });
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(mockOra.mock.results[0]?.value.succeed).toHaveBeenCalledWith(
      `Simulator session created (id: session-123) ${deviceRunSessionUrl}`
    );
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining("export AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'")
    );
  });

  it('writes .env.eas-simulator with the environment variables by default', async () => {
    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);
    await command.runAsync();

    expect(mockLoadSimulatorEnvAsync).toHaveBeenCalledWith(projectDir);
    expect(fs.writeFile).toHaveBeenNthCalledWith(
      1,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER + `${EAS_SIMULATOR_SESSION_ID}="session-123"\n`
    );
    expect(fs.writeFile).toHaveBeenNthCalledWith(
      2,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER +
        'AGENT_DEVICE_DAEMON_BASE_URL="https://agent.example.com"\n' +
        'AGENT_DEVICE_DAEMON_AUTH_TOKEN="token-123"\n' +
        `${EAS_SIMULATOR_SESSION_ID}="session-123"\n`
    );
    expect(jest.mocked(fs.writeFile).mock.invocationCallOrder[0]).toBeLessThan(
      mockByIdAsync.mock.invocationCallOrder[0]
    );
    expect(mockOra.mock.results[0]?.value.succeed).toHaveBeenCalledWith(
      `Simulator session created (id: session-123, saved to ${SIMULATOR_DOTENV_FILE_NAME}) ${deviceRunSessionUrl}`
    );
    expect(Log.withTick).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(
      [
        '🔑 Run the following to use agent-device with the simulator:',
        '',
        'eas simulator:exec agent-device <command>',
        '',
        '🌐 Open the following URL in your browser to preview the simulator:',
        '',
        'https://preview.example.com',
      ].join('\n')
    );
  });

  it('overwrites .env.eas-simulator when outputting dotenv and the file exists', async () => {
    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--out-config-type',
      'dotenv',
    ]);
    await command.runAsync();

    expect(fs.writeFile).toHaveBeenNthCalledWith(
      1,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER + `${EAS_SIMULATOR_SESSION_ID}="session-123"\n`
    );
    expect(fs.writeFile).toHaveBeenNthCalledWith(
      2,
      simulatorDotenvPath,
      SIMULATOR_DOTENV_FILE_HEADER +
        'AGENT_DEVICE_DAEMON_BASE_URL="https://agent.example.com"\n' +
        'AGENT_DEVICE_DAEMON_AUTH_TOKEN="token-123"\n' +
        `${EAS_SIMULATOR_SESSION_ID}="session-123"\n`
    );
  });

  it(`warns and creates a new session when ${EAS_SIMULATOR_SESSION_ID} is already present by default`, async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'existing-session';

    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);
    await command.runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      '  Overwriting previous simulator session (id: existing-session). ' +
        'The previous remote session will continue running until stopped. ' +
        'To stop it, run: eas simulator:stop --id existing-session'
    );
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      packageVersion: undefined,
      platform: AppPlatform.Ios,
      type: DeviceRunSessionType.AgentDevice,
    });
  });

  it(`creates a new session when ${EAS_SIMULATOR_SESSION_ID} is present with --force`, async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'existing-session';

    const { command } = createCommand(['--platform', 'ios', '--non-interactive', '--force']);
    await command.runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      '  Overwriting previous simulator session (id: existing-session). ' +
        'The previous remote session will continue running until stopped. ' +
        'To stop it, run: eas simulator:stop --id existing-session'
    );
    expect(mockCreateDeviceRunSessionAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-123',
      packageVersion: undefined,
      platform: AppPlatform.Ios,
      type: DeviceRunSessionType.AgentDevice,
    });
  });

  it(`throws when ${EAS_SIMULATOR_SESSION_ID} is already present with --no-force`, async () => {
    process.env[EAS_SIMULATOR_SESSION_ID] = 'existing-session';

    const { command } = createCommand(['--platform', 'ios', '--non-interactive', '--no-force']);
    await expect(command.runAsync()).rejects.toThrow(
      'Existing simulator session in environment. Use --force to create a new simulator session.'
    );

    expect(mockCreateDeviceRunSessionAsync).not.toHaveBeenCalled();
  });

  it('resets .env.eas-simulator when the interactive wait observes the session end', async () => {
    mockByIdAsync
      .mockResolvedValueOnce(makeDeviceRunSession())
      .mockResolvedValueOnce(makeDeviceRunSession({ status: DeviceRunSessionStatus.Stopped }));

    const { command } = createCommand(['--platform', 'ios']);
    await command.runAsync();

    expect(mockResetSimulatorEnvAsync).toHaveBeenCalledWith(projectDir);
  });
});
