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

const mockCreateDeviceRunSessionAsync = jest.mocked(
  DeviceRunSessionMutation.createDeviceRunSessionAsync
);
const mockByIdAsync = jest.mocked(DeviceRunSessionQuery.byIdAsync);

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
    app: {
      id: 'app-123',
      slug: 'testapp',
      ownerAccount: {
        id: 'account-123',
        name: 'testuser',
      },
    },
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDeviceRunSessionAsync.mockResolvedValue(makeCreatedDeviceRunSession());
    mockByIdAsync.mockResolvedValue(makeDeviceRunSession());
    jest.mocked(fs.appendFile).mockResolvedValue(undefined as never);
    jest.mocked(fs.readFile).mockResolvedValue('' as never);
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
    expect(fs.appendFile).not.toHaveBeenCalled();
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining("export AGENT_DEVICE_DAEMON_BASE_URL='https://agent.example.com'")
    );
  });

  it('creates .env.eas-simulator with the environment variables by default', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(false as never);

    const { command } = createCommand(['--platform', 'ios', '--non-interactive']);
    await command.runAsync();

    expect(fs.appendFile).toHaveBeenCalledWith(
      simulatorDotenvPath,
      'AGENT_DEVICE_DAEMON_BASE_URL="https://agent.example.com"\n' +
        'AGENT_DEVICE_DAEMON_AUTH_TOKEN="token-123"\n' +
        'EAS_SIMULATOR_SESSION_ID="session-123"\n'
    );
    expect(Log.withTick).toHaveBeenCalledWith(
      'Wrote simulator environment variables to .env.eas-simulator'
    );
    expect(Log.log).toHaveBeenCalledWith(
      '🔑 Run the following to use agent-device with the simulator:'
    );
    expect(Log.log).toHaveBeenCalledWith('eas simulator:exec agent-device <command>');
    expect(Log.log).toHaveBeenCalledWith(
      '🌐 Open the following URL in your browser to preview the simulator:'
    );
    expect(Log.log).toHaveBeenCalledWith('https://preview.example.com');
  });

  it('appends the environment variables when outputting dotenv and .env.eas-simulator exists', async () => {
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue('EXISTING_ENV=1' as never);

    const { command } = createCommand([
      '--platform',
      'ios',
      '--non-interactive',
      '--out-config-type',
      'dotenv',
    ]);
    await command.runAsync();

    expect(fs.readFile).toHaveBeenCalledWith(simulatorDotenvPath, 'utf8');
    expect(fs.appendFile).toHaveBeenCalledWith(
      simulatorDotenvPath,
      '\nAGENT_DEVICE_DAEMON_BASE_URL="https://agent.example.com"\n' +
        'AGENT_DEVICE_DAEMON_AUTH_TOKEN="token-123"\n' +
        'EAS_SIMULATOR_SESSION_ID="session-123"\n'
    );
  });
});
