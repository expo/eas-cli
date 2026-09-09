import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { getMockOclifConfig } from '../../../__tests__/commands/utils';
import { WorkflowDeviceTestCaseStatus } from '../../../graphql/generated';
import { WorkflowDeviceTestCaseInsightsQuery } from '../../../graphql/queries/WorkflowDeviceTestCaseInsightsQuery';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';
import WorkflowInsightsMaestro from '../insights/maestro';

jest.mock('../../../graphql/queries/WorkflowDeviceTestCaseInsightsQuery', () => ({
  WorkflowDeviceTestCaseInsightsQuery: {
    insightsByAppIdAsync: jest.fn(),
    historyByAppIdAsync: jest.fn(),
  },
}));
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../log');
jest.mock('../../../utils/json');

const mockInsightsByAppIdAsync = jest.mocked(
  WorkflowDeviceTestCaseInsightsQuery.insightsByAppIdAsync
);
const mockHistoryByAppIdAsync = jest.mocked(
  WorkflowDeviceTestCaseInsightsQuery.historyByAppIdAsync
);
const mockByIdWorkflowFileNamesAsync = jest.mocked(AppQuery.byIdWorkflowFileNamesAsync);
const mockEnableJsonOutput = jest.mocked(enableJsonOutput);
const mockPrintJsonOnlyOutput = jest.mocked(printJsonOnlyOutput);

function metric(currentValue: number, previousValue: number): any {
  return { __typename: 'WorkflowDeviceTestCaseInsightsMetric', currentValue, previousValue };
}

const totals: any = {
  __typename: 'WorkflowDeviceTestCaseInsightsTotals',
  totalRuns: metric(200, 160),
  passedCleanCount: metric(170, 140),
  flakyCount: metric(10, 4),
  failedCount: metric(20, 16),
  distinctFlakyTestCount: metric(3, 2),
  avgDurationMs: { currentValue: 42100, previousValue: 45000 },
  p90DurationMs: { currentValue: 72000, previousValue: null },
};

const timeSeries: any[] = [
  { bucketStartAt: '2026-09-01T00:00:00.000Z', passedClean: 100, flaky: 5, failed: 10 },
];

const insightsResponse: any = {
  __typename: 'App',
  id: 'app-1',
  fullName: '@acme/app',
  workflowDeviceTestCaseInsights: {
    totals,
    timeSeries,
    tests: {
      edges: [
        {
          node: {
            path: 'flows/login.yaml',
            name: 'Login',
            totalRuns: 120,
            passedCleanCount: 100,
            flakyCount: 8,
            failedCount: 12,
            avgDurationMs: 40000,
            p90DurationMs: 70000,
            lastRunAt: '2026-09-02T10:30:00.000Z',
            lastRunStatus: WorkflowDeviceTestCaseStatus.Failed,
            lastRunIsFlaky: false,
          },
        },
      ],
      pageInfo: { hasNextPage: false },
      totalCount: 1,
    },
  },
};

const historyResponse: any = {
  __typename: 'App',
  id: 'app-1',
  fullName: '@acme/app',
  workflowDeviceTestCaseHistory: {
    totals,
    timeSeries,
    errorPatterns: [
      {
        sampleMessage: 'Element not found',
        count: 7,
      },
    ],
    recentRuns: {
      edges: [
        {
          node: {
            id: 'r1',
            status: WorkflowDeviceTestCaseStatus.Failed,
            durationMs: 41000,
            isFlaky: false,
            createdAt: '2026-09-02T10:30:00.000Z',
            workflowRunId: 'wr-1',
            workflowRunName: 'E2E #42',
            gitRef: 'refs/heads/main',
            commitSha: 'abcdef1234567',
          },
        },
      ],
      pageInfo: { hasNextPage: false },
      totalCount: 1,
    },
  },
};

describe(WorkflowInsightsMaestro, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const now = new Date('2026-09-08T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now });
    mockInsightsByAppIdAsync.mockResolvedValue(insightsResponse);
    mockHistoryByAppIdAsync.mockResolvedValue(historyResponse);
    mockByIdWorkflowFileNamesAsync.mockResolvedValue([
      { id: 'id-of-e2e.yml', fileName: 'e2e.yml' },
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createCommand(argv: string[]): {
    command: WorkflowInsightsMaestro;
    getContextAsync: jest.SpyInstance;
  } {
    const command = new WorkflowInsightsMaestro(argv, mockConfig);
    const getContextAsync = jest
      .spyOn(command as any, 'getContextAsync')
      .mockImplementation(async (_commandClass: any, { projectIdOverride }: any) => ({
        projectId: projectIdOverride ?? 'app-1',
        loggedIn: { graphqlClient },
      }));
    return { command, getContextAsync };
  }

  it('queries the overview for the last 7 days sorted by fails with the default limit', async () => {
    const { command } = createCommand([]);
    await command.runAsync();

    expect(mockInsightsByAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'app-1',
      startTime: '2026-09-01T00:00:00.000Z',
      endTime: '2026-09-09T00:00:00.000Z',
      filters: undefined,
      granularity: 'DAY',
      sortField: 'FAILS',
      sortDirection: 'DESC',
      search: undefined,
      first: 50,
    });
    expect(mockHistoryByAppIdAsync).not.toHaveBeenCalled();
  });

  it('passes filters, search, sort, and limit to the server', async () => {
    const { command } = createCommand([
      '--workflow',
      'e2e.yml',
      '--status',
      'PASSED',
      '--status',
      'FLAKY',
      '--tag',
      'smoke',
      '--git-ref',
      'main',
      '--search',
      'login',
      '--sort',
      'pass-rate',
      '--sort-direction',
      'asc',
      '--limit',
      '10',
    ]);
    await command.runAsync();

    expect(mockByIdWorkflowFileNamesAsync).toHaveBeenCalledWith(graphqlClient, 'app-1');
    expect(mockInsightsByAppIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        filters: {
          workflowIds: ['id-of-e2e.yml'],
          statuses: ['PASSED_CLEAN', 'FLAKY'],
          tags: ['smoke'],
          gitRefs: ['refs/heads/main'],
        },
        search: 'login',
        sortField: 'PASS_RATE',
        sortDirection: 'ASC',
        first: 10,
      })
    );
  });

  it('queries one flow history with --flow, keeping only the workflow and git ref filters', async () => {
    const { command } = createCommand([
      '--flow',
      'flows/login.yaml',
      '--workflow',
      'e2e.yml',
      '--git-ref',
      'main',
    ]);
    await command.runAsync();

    expect(mockHistoryByAppIdAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'app-1',
      path: 'flows/login.yaml',
      startTime: '2026-09-01T00:00:00.000Z',
      endTime: '2026-09-09T00:00:00.000Z',
      filters: { workflowIds: ['id-of-e2e.yml'], gitRefs: ['refs/heads/main'] },
      granularity: 'DAY',
      errorPatternsFirst: 5,
      recentRunsFirst: 50,
    });
    expect(mockInsightsByAppIdAsync).not.toHaveBeenCalled();
  });

  it('rejects overview-only flags together with --flow', async () => {
    const { command } = createCommand(['--flow', 'flows/login.yaml', '--status', 'FAILED']);
    await expect(command.runAsync()).rejects.toThrow();
    expect(mockHistoryByAppIdAsync).not.toHaveBeenCalled();
  });

  it('rejects unknown statuses', async () => {
    const { command } = createCommand(['--status', 'BROKEN']);
    await expect(command.runAsync()).rejects.toThrow();
  });

  it('skips the project directory when --project-id is given', async () => {
    const { command, getContextAsync } = createCommand(['--project-id', 'other-app']);
    await command.runAsync();

    expect(getContextAsync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectIdOverride: 'other-app' })
    );
    expect(mockInsightsByAppIdAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({ appId: 'other-app' })
    );
  });

  it('emits the overview as JSON', async () => {
    const { command } = createCommand(['--json', '--non-interactive']);
    await command.runAsync();

    expect(mockEnableJsonOutput).toHaveBeenCalled();
    const json = mockPrintJsonOnlyOutput.mock.calls[0][0] as any;
    expect(json.project).toBe('@acme/app');
    expect(json.totals.passRatePercent).toEqual({ current: 90, previous: 90 });
    expect(json.totals.avgDurationMs).toEqual({ current: 42100, previous: 45000 });
    expect(json.flows[0].path).toBe('flows/login.yaml');
    expect(json.sort).toEqual({ field: 'fails', direction: 'desc' });
  });

  it('emits a flow history as JSON', async () => {
    const { command } = createCommand([
      '--flow',
      'flows/login.yaml',
      '--json',
      '--non-interactive',
    ]);
    await command.runAsync();

    const json = mockPrintJsonOnlyOutput.mock.calls[0][0] as any;
    expect(json.flow).toBe('flows/login.yaml');
    expect(json.errorPatterns).toHaveLength(1);
    expect(json.recentRuns[0].workflowRunId).toBe('wr-1');
  });

  it('turns a plan-gate rejection into a readable error', async () => {
    const graphQLError = new GraphQLError(
      'Maestro insights are not available for your current plan.',
      null,
      null,
      null,
      null,
      null,
      { errorCode: 'EAS_WORKFLOW_DEVICE_TEST_CASE_INSIGHTS_NOT_AVAILABLE' }
    );
    mockInsightsByAppIdAsync.mockRejectedValue(
      new CombinedError({ graphQLErrors: [graphQLError] })
    );

    const { command } = createCommand([]);
    await expect(command.runAsync()).rejects.toThrow(
      'Maestro insights are not available for your current plan.'
    );
  });
});
