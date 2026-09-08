import {
  WorkflowRunStatus,
  WorkflowsInsightsRunsOverTimeGranularity,
} from '../../../graphql/generated';
import { AppWithWorkflowsInsightsObject } from '../../../graphql/queries/WorkflowsInsightsQuery';
import {
  WorkflowsInsightsSummary,
  buildWorkflowsInsightsJson,
  buildWorkflowsInsightsTable,
  formatTrend,
  successRatePercent,
  toWorkflowsInsightsSummary,
} from '../formatInsights';

function metric(currentValue: number, previousValue: number): any {
  return { __typename: 'WorkflowsInsightsMetric', currentValue, previousValue };
}

function makeApp(
  overrides: {
    labels?: string[];
    datasets?: { id: string; data: (number | null)[] }[];
    workflows?: any[];
    hasNextPage?: boolean;
  } = {}
): AppWithWorkflowsInsightsObject {
  return {
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
          labels: overrides.labels ?? ['2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'],
          datasets: overrides.datasets ?? [
            // Deliberately out of order: buckets must be matched by dataset id.
            {
              id: 'WorkflowsInsightsRunsOverTimeDataset:canceled',
              data: [3, 2],
            },
            {
              id: 'WorkflowsInsightsRunsOverTimeDataset:total',
              data: [60, 40],
            },
            {
              id: 'WorkflowsInsightsRunsOverTimeDataset:failure',
              data: [12, null],
            },
            {
              id: 'WorkflowsInsightsRunsOverTimeDataset:success',
              data: [45, 30],
            },
          ],
        },
      },
      workflows: {
        __typename: 'WorkflowsInsightsWorkflowConnection',
        edges: (
          overrides.workflows ?? [
            {
              workflowId: 'wf-1',
              name: 'Build',
              totalRuns: 60,
              successfulRuns: 45,
              failedRuns: 12,
              canceledRuns: 3,
              lastRunAt: '2026-09-02T10:30:00.000Z',
            },
            {
              workflowId: 'wf-2',
              name: 'Tests',
              totalRuns: 0,
              successfulRuns: 0,
              failedRuns: 0,
              canceledRuns: 0,
              lastRunAt: '2026-08-20T08:00:00.000Z',
            },
          ]
        ).map(node => ({
          __typename: 'WorkflowsInsightsWorkflowEdge',
          node: { __typename: 'WorkflowsInsightsWorkflowNode', ...node },
        })),
        pageInfo: { __typename: 'PageInfo', hasNextPage: overrides.hasNextPage ?? false },
      },
    },
  };
}

const TIMESPAN = {
  startTime: '2026-08-26T00:00:00.000Z',
  endTime: '2026-09-02T00:00:00.000Z',
  daysBack: 7,
};

function makeSummary(
  overrides: Parameters<typeof makeApp>[0] = {},
  filters?: WorkflowsInsightsSummary['filters']
): WorkflowsInsightsSummary {
  return toWorkflowsInsightsSummary(makeApp(overrides), {
    timespan: TIMESPAN,
    granularity: WorkflowsInsightsRunsOverTimeGranularity.Day,
    filters,
  });
}

describe(toWorkflowsInsightsSummary, () => {
  it('copies the overview metrics as current/previous pairs and derives the success rate', () => {
    const summary = makeSummary();

    expect(summary.appFullName).toBe('@acme/app');
    expect(summary.overview.totalRuns).toEqual({ current: 100, previous: 80 });
    expect(summary.overview.failedRuns).toEqual({ current: 20, previous: 10 });
    expect(summary.overview.successRatePercent).toEqual({ current: 75, previous: 80 });
    expect(Object.keys(summary.overview)).toEqual([
      'totalRuns',
      'successRatePercent',
      'activeWorkflows',
      'failedRuns',
    ]);
  });

  it('matches runs-over-time buckets by dataset id and treats missing points as zero', () => {
    const summary = makeSummary();

    expect(summary.runsOverTime).toEqual([
      {
        start: '2026-09-01T00:00:00.000Z',
        totalRuns: 60,
        successfulRuns: 45,
        failedRuns: 12,
        canceledRuns: 3,
      },
      {
        start: '2026-09-02T00:00:00.000Z',
        totalRuns: 40,
        successfulRuns: 30,
        failedRuns: 0,
        canceledRuns: 2,
      },
    ]);
  });

  it('fails loudly when the server response lacks a dataset', () => {
    expect(() =>
      makeSummary({
        datasets: [{ id: 'WorkflowsInsightsRunsOverTimeDataset:total', data: [60, 40] }],
      })
    ).toThrow('missing the "WorkflowsInsightsRunsOverTimeDataset:success" dataset');
  });

  it('derives a per-workflow success rate and keeps the has-more flag', () => {
    const summary = makeSummary({ hasNextPage: true });

    expect(summary.workflows.map(w => [w.name, w.successRatePercent])).toEqual([
      ['Build', 75],
      ['Tests', 0],
    ]);
    expect(summary.hasMoreWorkflows).toBe(true);
  });
});

describe(successRatePercent, () => {
  it('returns 0 when there are no runs', () => {
    expect(successRatePercent(0, 0)).toBe(0);
  });

  it('returns the share of successful runs as a percentage', () => {
    expect(successRatePercent(3, 4)).toBe(75);
  });
});

describe(formatTrend, () => {
  it('is n/a when the previous period had no data', () => {
    expect(formatTrend({ current: 10, previous: 0 })).toContain('n/a');
  });

  it('formats the percentage change with a sign', () => {
    expect(formatTrend({ current: 125, previous: 100 })).toContain('+25.0%');
    expect(formatTrend({ current: 50, previous: 100 })).toContain('-50.0%');
    expect(formatTrend({ current: 100, previous: 100 })).toContain('0.0%');
  });
});

describe(buildWorkflowsInsightsJson, () => {
  it('builds the JSON payload with timespan, overview, buckets, and workflows', () => {
    const json = buildWorkflowsInsightsJson(makeSummary()) as any;

    expect(json.project).toBe('@acme/app');
    expect(json.timespan).toEqual({
      start: TIMESPAN.startTime,
      end: TIMESPAN.endTime,
      daysBack: 7,
    });
    expect(json.filters).toBeUndefined();
    expect(json.overview.successRatePercent).toEqual({ current: 75, previous: 80 });
    expect(json.runsOverTime.granularity).toBe('DAY');
    expect(json.runsOverTime.buckets).toHaveLength(2);
    expect(json.workflows[0]).toEqual({
      workflowId: 'wf-1',
      name: 'Build',
      totalRuns: 60,
      successfulRuns: 45,
      failedRuns: 12,
      canceledRuns: 3,
      successRatePercent: 75,
      lastRunAt: '2026-09-02T10:30:00.000Z',
    });
    expect(json.hasMoreWorkflows).toBe(false);
  });

  it('omits daysBack for explicit ranges and includes the applied filters', () => {
    const summary = toWorkflowsInsightsSummary(makeApp(), {
      timespan: { startTime: TIMESPAN.startTime, endTime: TIMESPAN.endTime },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Day,
      filters: { workflows: ['build.yml'], gitRef: 'refs/heads/main' },
    });
    const json = buildWorkflowsInsightsJson(summary) as any;

    expect(json.timespan).toEqual({ start: TIMESPAN.startTime, end: TIMESPAN.endTime });
    expect(json.filters).toEqual({ workflows: ['build.yml'], gitRef: 'refs/heads/main' });
  });
});

describe(buildWorkflowsInsightsTable, () => {
  it('renders the header, overview, runs over time, and workflows table', () => {
    const table = buildWorkflowsInsightsTable(makeSummary());

    expect(table).toContain('Workflows insights:');
    expect(table).toContain('@acme/app');
    expect(table).toContain('last 7 days');
    expect(table).toContain('Total runs');
    expect(table).toContain('+25.0%');
    expect(table).toContain('Success rate');
    expect(table).toContain('75.0%');
    expect(table).toContain('-5.0 pts');
    expect(table).toContain('Runs over time (daily, UTC):');
    expect(table).toContain('2026-09-01');
    expect(table).toContain('Build');
    expect(table).toContain('2026-09-02 10:30');
    expect(table).not.toContain('Filters');
    expect(table).not.toContain('with the most runs');
  });

  it('shows the applied filters and the has-more hint', () => {
    const table = buildWorkflowsInsightsTable(
      makeSummary(
        { hasNextPage: true },
        { statuses: [WorkflowRunStatus.Failure], gitRef: 'refs/heads/main' }
      )
    );

    expect(table).toContain('Filters');
    expect(table).toContain('statuses: FAILURE; git ref: refs/heads/main');
    expect(table).toContain('Workflows (the 2 with the most runs):');
  });

  it('labels hourly buckets with the time', () => {
    const summary = toWorkflowsInsightsSummary(makeApp(), {
      timespan: { startTime: '2026-09-01T00:00:00.000Z', endTime: '2026-09-02T00:00:00.000Z' },
      granularity: WorkflowsInsightsRunsOverTimeGranularity.Hour,
    });
    const table = buildWorkflowsInsightsTable(summary);

    expect(table).toContain('Runs over time (hourly, UTC):');
    expect(table).toContain('2026-09-01 00:00');
  });

  it('says so when no workflow ran', () => {
    const table = buildWorkflowsInsightsTable(makeSummary({ workflows: [], labels: [] }));

    expect(table).toContain('No workflow runs in this time range.');
    expect(table).not.toContain('Runs over time');
  });

  it('shows n/a instead of a success rate when there were no runs', () => {
    const app = makeApp();
    app.workflowsInsights.overviewMetrics.totalRuns = metric(0, 0);
    app.workflowsInsights.overviewMetrics.successfulRuns = metric(0, 0);
    const table = buildWorkflowsInsightsTable(
      toWorkflowsInsightsSummary(app, {
        timespan: TIMESPAN,
        granularity: WorkflowsInsightsRunsOverTimeGranularity.Day,
      })
    );

    // Chalk styles the label and value separately, so strip the escape codes first.
    expect(table.replace(/\x1b\[[0-9;]*m/g, '')).toMatch(/Success rate\s+n\/a/);
    expect(table).not.toContain('0.0 pts');
  });
});
