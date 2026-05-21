import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  DeviceRunSessionByIdQuery,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  JobRunStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorGet from '../get';

jest.mock('../../../graphql/queries/DeviceRunSessionQuery');
jest.mock('../../../log');
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
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

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

describe(SimulatorGet, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createCommand(argv: string[]): {
    command: SimulatorGet;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new SimulatorGet(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      loggedIn: { graphqlClient },
    });
    return { command, getContextAsync };
  }

  it('emits JSON when --json is passed', async () => {
    const session = makeDeviceRunSession();
    mockByIdAsync.mockResolvedValue(session);

    const { command, getContextAsync } = createCommand(['--id', 'session-123', '--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(getContextAsync).toHaveBeenCalledWith(SimulatorGet, {
      nonInteractive: true,
    });
    expect(mockByIdAsync).toHaveBeenCalledWith(graphqlClient, 'session-123');
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      id: 'session-123',
      type: 'agent-device',
      status: DeviceRunSessionStatus.InProgress,
      jobRunUrl: 'https://expo.dev/accounts/testuser/projects/testapp/job-runs/job-123',
      remoteConfig: session.remoteConfig,
    });
  });
});
