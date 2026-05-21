import { Config } from '@oclif/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  DeviceRunSessionStatus,
  DeviceRunSessionType,
  DeviceRunSessionsByAppIdQuery,
  JobRunStatus,
} from '../../../graphql/generated';
import { DeviceRunSessionQuery } from '../../../graphql/queries/DeviceRunSessionQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import SimulatorList from '../list';

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

type DeviceRunSessionEdge =
  DeviceRunSessionsByAppIdQuery['app']['byId']['deviceRunSessionsPaginated']['edges'][number];
type DeviceRunSessionNode = DeviceRunSessionEdge['node'];
type DeviceRunSessionsPaginated =
  DeviceRunSessionsByAppIdQuery['app']['byId']['deviceRunSessionsPaginated'];

const mockListByAppIdAsync = jest.mocked(DeviceRunSessionQuery.listByAppIdAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function makeSession(overrides: Partial<DeviceRunSessionNode> = {}): DeviceRunSessionNode {
  return {
    id: 'session-123',
    status: DeviceRunSessionStatus.InProgress,
    type: DeviceRunSessionType.AgentDevice,
    platform: AppPlatform.Ios,
    createdAt: '2025-01-01T00:00:00.000Z',
    startedAt: '2025-01-01T00:00:05.000Z',
    finishedAt: null,
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
      status: JobRunStatus.InProgress,
    },
    ...overrides,
  };
}

function makeConnection(
  nodes: DeviceRunSessionNode[],
  pageInfo: Partial<DeviceRunSessionsPaginated['pageInfo']> = {}
): DeviceRunSessionsPaginated {
  return {
    edges: nodes.map((node, index) => ({ cursor: `cursor-${index}`, node })),
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: nodes.length > 0 ? 'cursor-0' : null,
      endCursor: nodes.length > 0 ? `cursor-${nodes.length - 1}` : null,
      ...pageInfo,
    },
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

describe(SimulatorList, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createCommand(argv: string[]): {
    command: SimulatorList;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new SimulatorList(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId: 'app-123',
      loggedIn: { graphqlClient },
    });
    return { command, getContextAsync };
  }

  it('emits JSON when --json is passed', async () => {
    const session = makeSession();
    mockListByAppIdAsync.mockResolvedValue(makeConnection([session]));

    const { command, getContextAsync } = createCommand(['--json']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    expect(getContextAsync).toHaveBeenCalledWith(SimulatorList, {
      nonInteractive: true,
    });
    expect(mockListByAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'app-123',
      first: 10,
      after: undefined,
      filter: undefined,
    });
    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      sessions: [
        {
          id: 'session-123',
          type: 'agent-device',
          status: DeviceRunSessionStatus.InProgress,
          platform: AppPlatform.Ios,
          createdAt: '2025-01-01T00:00:00.000Z',
          startedAt: '2025-01-01T00:00:05.000Z',
          finishedAt: undefined,
          jobRunUrl: 'https://expo.dev/accounts/testuser/projects/testapp/job-runs/job-123',
        },
      ],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: 'cursor-0',
        endCursor: 'cursor-0',
      },
    });
  });

  it('passes filters and cursor to the query', async () => {
    mockListByAppIdAsync.mockResolvedValue(makeConnection([]));

    const { command } = createCommand([
      '--json',
      '--status',
      'in-progress',
      '--status',
      'new',
      '--type',
      'argent',
      '--platform',
      'ios',
      '--limit',
      '25',
      '--after',
      'page-cursor',
    ]);
    await command.runAsync();

    expect(mockListByAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'app-123',
      first: 25,
      after: 'page-cursor',
      filter: {
        statuses: [DeviceRunSessionStatus.InProgress, DeviceRunSessionStatus.New],
        types: [DeviceRunSessionType.Argent],
        platforms: [AppPlatform.Ios],
      },
    });
  });

  it('runs non-interactively without --json', async () => {
    const session = makeSession({ id: 'session-1', turtleJobRun: null });
    mockListByAppIdAsync.mockResolvedValue(makeConnection([session]));

    const { command, getContextAsync } = createCommand(['--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).not.toHaveBeenCalled();
    expect(mockPrintJsonOnlyOutput).not.toHaveBeenCalled();
    expect(getContextAsync).toHaveBeenCalledWith(SimulatorList, {
      nonInteractive: true,
    });
    expect(mockListByAppIdAsync).toHaveBeenCalled();
  });

  it('handles empty results', async () => {
    mockListByAppIdAsync.mockResolvedValue(makeConnection([]));

    const { command } = createCommand(['--json']);
    await command.runAsync();

    expect(mockPrintJsonOnlyOutput).toHaveBeenCalledWith({
      sessions: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
    });
  });
});
