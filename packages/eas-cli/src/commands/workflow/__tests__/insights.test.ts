import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { WorkflowQuery } from '../../../graphql/queries/WorkflowQuery';
import { WorkflowsInsightsQuery } from '../../../graphql/queries/WorkflowsInsightsQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import WorkflowInsights from '../insights';

jest.mock('../../../graphql/queries/WorkflowsInsightsQuery', () => ({
  WorkflowsInsightsQuery: { byAppIdAsync: jest.fn() },
}));
jest.mock('../../../graphql/queries/WorkflowQuery', () => ({
  WorkflowQuery: { byAppIdAndFileNameAsync: jest.fn() },
}));
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockByAppIdAsync = jest.mocked(WorkflowsInsightsQuery.byAppIdAsync);
const mockByAppIdAndFileNameAsync = jest.mocked(WorkflowQuery.byAppIdAndFileNameAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function metric(currentValue: number, previousValue: number): any {
  return { __typename: 'WorkflowsInsightsMetric', currentValue, previousValue };
}

const appResponse: any = {
  __typename: 'App',
  id: 'app-1',
  fullName: '@acme/app',
  workflowsInsights: {
    __typename: 'AppWorkflowsInsights',
    overviewMetrics: {
      __typename: 'WorkflowsInsightsOverviewMetrics',
      totalRuns: metric(100, 80),
      successfulRuns: metric(75, 64),
      failedRuns: metric(20, 10),
      activeWorkflows: metric(3, 3),
    },
    runsOverTime: {
      __typename: 'WorkflowsInsightsRunsOverTimeData',
      lineChart: {
        __typename: 'LineChartData',
        labels: ['2026-09-01T00:00:00.000Z'],
        datasets: [
          { id: 'WorkflowsInsightsRunsOverTimeDataset:total', label: 'Total Runs', data: [100] },
          {
            id: 'WorkflowsInsightsRunsOverTimeDataset:success',
            data: [75],
          },
          { id: 'WorkflowsInsightsRunsOverTimeDataset:failure', label: 'Failed Runs', data: [20] },
          {
            id: 'WorkflowsInsightsRunsOverTimeDataset:canceled',
            data: [5],
          },
        ],
      },
    },
    workflows: {
      __typename: 'WorkflowsInsightsWorkflowConnection',
      edges: [
        {
          __typename: 'WorkflowsInsightsWorkflowEdge',
          node: {
            __typename: 'WorkflowsInsightsWorkflowNode',
            workflowId: 'wf-build',
            name: 'Build',
            totalRuns: 100,
            successfulRuns: 75,
            failedRuns: 20,
            canceledRuns: 5,
            lastRunAt: '2026-09-01T10:00:00.000Z',
          },
        },
      ],
      pageInfo: { __typename: 'PageInfo', hasNextPage: false },
    },
  },
};

describe(WorkflowInsights, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const now = new Date('2026-09-08T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now });
    mockByAppIdAsync.mockResolvedValue(appResponse);
    mockByAppIdAndFileNameAsync.mockImplementation(async (_client, { fileName }) => ({
      id: `id-of-${fileName}`,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createCommand(argv: string[]): {
    command: WorkflowInsights;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new WorkflowInsights(argv, mockConfig);
    // @ts-expect-error getContextAsync is protected
    const getContextAsync = jest.spyOn(command, 'getContextAsync').mockResolvedValue({
      projectId: 'app-1',
      loggedIn: { graphqlClient },
    });
    return { command, getContextAsync };
  }

  it('queries the last 7 days by day with no filters and the default limit', async () => {
    const { command } = createCommand([]);
    await command.runAsync();

    expect(mockByAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'app-1',
      startTime: '2026-09-01T12:00:00.000Z',
      endTime: '2026-09-08T12:00:00.000Z',
      filters: undefined,
      granularity: 'DAY',
      first: 50,
    });
  });

  it('picks hourly buckets for --days 1 and per-minute buckets for a short explicit range', async () => {
    const { command: dayCommand } = createCommand(['--days', '1']);
    await dayCommand.runAsync();
    expect(mockByAppIdAsync).toHaveBeenLastCalledWith(
      graphqlClient,
      expect.objectContaining({ startTime: '2026-09-07T12:00:00.000Z', granularity: 'HOUR' })
    );

    const { command: rangeCommand } = createCommand([
      '--start',
      '2026-09-08T10:00:00.000Z',
      '--end',
      '2026-09-08T11:00:00.000Z',
    ]);
    await rangeCommand.runAsync();
    expect(mockByAppIdAsync).toHaveBeenLastCalledWith(
      graphqlClient,
      expect.objectContaining({
        startTime: '2026-09-08T10:00:00.000Z',
        endTime: '2026-09-08T11:00:00.000Z',
        granularity: 'MINUTE',
      })
    );
  });

  it('rejects --end without --start', async () => {
    const { command } = createCommand(['--end', '2026-09-08T11:00:00.000Z']);
    await expect(command.runAsync()).rejects.toThrow(/--end requires --start/);
    expect(mockByAppIdAsync).not.toHaveBeenCalled();
  });

  it('rejects --days combined with --start', async () => {
    const { command } = createCommand(['--days', '7', '--start', '2026-09-01T00:00:00.000Z']);
    await expect(command.runAsync()).rejects.toThrow();
  });

  it('resolves workflow file names and passes the other filters to the server', async () => {
    const { command } = createCommand([
      '--workflow',
      'build.yml',
      '--status',
      'FAILURE',
      '--status',
      'CANCELED',
      '--trigger',
      'GITHUB_PUSH',
      '--git-ref',
      'main',
    ]);
    await command.runAsync();

    expect(mockByAppIdAndFileNameAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'app-1',
      fileName: 'build.yml',
    });
    expect(mockByAppIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        filters: {
          workflowIds: ['id-of-build.yml'],
          statuses: ['FAILURE', 'CANCELED'],
          triggerEventTypes: ['GITHUB_PUSH'],
          gitRefRequested: ['refs/heads/main'],
        },
      })
    );
  });

  it('only accepts finished-run statuses', async () => {
    const { command } = createCommand(['--status', 'IN_PROGRESS']);
    await expect(command.runAsync()).rejects.toThrow();
    expect(mockByAppIdAsync).not.toHaveBeenCalled();
  });

  it('skips the project directory when --project-id is given', async () => {
    const { command, getContextAsync } = createCommand(['--project-id', 'other-app']);
    await command.runAsync();

    const [{ contextDefinition }] = getContextAsync.mock.calls[0];
    expect(Object.keys(contextDefinition)).toEqual(['loggedIn']);
    expect(mockByAppIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ appId: 'other-app' })
    );
  });

  it('rejects a non-integer --limit before querying', async () => {
    const { command } = createCommand(['--limit', '1.5']);
    await expect(command.runAsync()).rejects.toThrow(/as an integer/);
    expect(mockByAppIdAsync).not.toHaveBeenCalled();
  });

  it('passes --limit through as the page size', async () => {
    const { command } = createCommand(['--limit', '10']);
    await command.runAsync();

    expect(mockByAppIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ first: 10 })
    );
  });

  it('emits JSON when --json is passed', async () => {
    const { command } = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    const json = mockPrintJsonOnlyOutput.mock.calls[0][0] as any;
    expect(json.project).toBe('@acme/app');
    expect(json.timespan.daysBack).toBe(7);
    expect(json.overview.totalRuns).toEqual({ current: 100, previous: 80 });
    expect(json.overview.successRatePercent).toEqual({ current: 75, previous: 80 });
    expect(json.runsOverTime.granularity).toBe('DAY');
    expect(json.workflows[0].name).toBe('Build');
  });

  it('turns a plan-gate rejection into a readable error with the plan limit', async () => {
    const graphQLError = new GraphQLError(
      'The selected timeframe exceeds the supported range for workflow insights.',
      null,
      null,
      null,
      null,
      null,
      { errorCode: 'EAS_WORKFLOWS_INSIGHTS_TIMESPAN_LIMIT_EXCEEDED', metadata: { limitDays: 30 } }
    );
    mockByAppIdAsync.mockRejectedValue(new CombinedError({ graphQLErrors: [graphQLError] }));

    const { command } = createCommand(['--days', '90']);
    await expect(command.runAsync()).rejects.toThrow(
      'The selected timeframe exceeds the supported range for workflow insights. Your plan includes the last 30 days.'
    );
  });
});
