import {
  WorkflowDeviceTestCaseInsightsTimeSeriesGranularity,
  WorkflowDeviceTestCaseStatus,
} from '../../../graphql/generated';
import {
  AppWithMaestroFlowHistoryObject,
  AppWithMaestroInsightsObject,
} from '../../../graphql/queries/WorkflowDeviceTestCaseInsightsQuery';
import {
  MaestroFlowHistorySummary,
  MaestroInsightsSummary,
  buildMaestroFlowHistoryJson,
  buildMaestroFlowHistoryTable,
  buildMaestroInsightsJson,
  buildMaestroInsightsTable,
  formatDurationMs,
  toMaestroFlowHistorySummary,
  toMaestroInsightsSummary,
} from '../formatMaestroInsights';

function metric(currentValue: number, previousValue: number): any {
  return { __typename: 'WorkflowDeviceTestCaseInsightsMetric', currentValue, previousValue };
}

const timeSeries = [
  {
    __typename: 'WorkflowDeviceTestCaseInsightsBucket' as const,
    bucketStartAt: '2026-09-01T00:00:00.000Z',
    passedClean: 100,
    flaky: 5,
    failed: 10,
  },
  {
    __typename: 'WorkflowDeviceTestCaseInsightsBucket' as const,
    bucketStartAt: '2026-09-02T00:00:00.000Z',
    passedClean: 70,
    flaky: 5,
    failed: 10,
  },
];

function makeApp(
  overrides: { flows?: any[]; hasNextPage?: boolean; timeSeries?: typeof timeSeries } = {}
): AppWithMaestroInsightsObject {
  return {
    __typename: 'App',
    id: 'app-1',
    fullName: '@acme/app',
    workflowDeviceTestCaseInsights: {
      __typename: 'WorkflowDeviceTestCaseInsights',
      totals: {
        __typename: 'WorkflowDeviceTestCaseInsightsTotals',
        totalRuns: metric(200, 160),
        passedCleanCount: metric(170, 140),
        flakyCount: metric(10, 4),
        distinctFlakyTestCount: metric(3, 2),
        avgDurationMs: {
          __typename: 'WorkflowDeviceTestCaseInsightsNullableMetric',
          currentValue: 42100,
          previousValue: null,
        },
      },
      timeSeries: overrides.timeSeries ?? timeSeries,
      tests: {
        __typename: 'WorkflowDeviceTestCaseStatConnection',
        edges: (
          overrides.flows ?? [
            {
              path: 'flows/login.yaml',
              name: 'Login',
              totalRuns: 120,
              passedCleanCount: 100,
              flakyCount: 8,
              failedCount: 12,
              p90DurationMs: 70000,
              lastRunAt: '2026-09-02T10:30:00.000Z',
              lastRunStatus: WorkflowDeviceTestCaseStatus.Failed,
              lastRunIsFlaky: false,
            },
            {
              path: 'flows/checkout.yaml',
              name: 'Checkout',
              totalRuns: 80,
              passedCleanCount: 70,
              flakyCount: 2,
              failedCount: 8,
              p90DurationMs: null,
              lastRunAt: '2026-09-02T09:00:00.000Z',
              lastRunStatus: WorkflowDeviceTestCaseStatus.Passed,
              lastRunIsFlaky: true,
            },
          ]
        ).map(node => ({
          __typename: 'WorkflowDeviceTestCaseStatEdge',
          node: { __typename: 'WorkflowDeviceTestCaseStat', ...node },
        })),
        pageInfo: { __typename: 'PageInfo', hasNextPage: overrides.hasNextPage ?? true },
        totalCount: 5,
      },
    },
  };
}

function makeHistoryApp(): AppWithMaestroFlowHistoryObject {
  return {
    __typename: 'App',
    id: 'app-1',
    fullName: '@acme/app',
    workflowDeviceTestCaseHistory: {
      __typename: 'WorkflowDeviceTestCaseHistory',
      totals: {
        __typename: 'WorkflowDeviceTestCaseInsightsTotals',
        totalRuns: { __typename: 'WorkflowDeviceTestCaseInsightsMetric', currentValue: 200 },
        passedCleanCount: { __typename: 'WorkflowDeviceTestCaseInsightsMetric', currentValue: 170 },
        flakyCount: { __typename: 'WorkflowDeviceTestCaseInsightsMetric', currentValue: 10 },
        p90DurationMs: {
          __typename: 'WorkflowDeviceTestCaseInsightsNullableMetric',
          currentValue: 72000,
        },
      },
      timeSeries,
      errorPatterns: [
        {
          __typename: 'WorkflowDeviceTestCaseErrorPattern',
          sampleMessage: 'Element not found:\n  id "login-button"',
          count: 7,
        },
      ],
      recentRuns: {
        __typename: 'WorkflowDeviceTestCaseRecentRunConnection',
        edges: [
          {
            __typename: 'WorkflowDeviceTestCaseRecentRunEdge',
            node: {
              __typename: 'WorkflowDeviceTestCaseRecentRun',
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
          {
            __typename: 'WorkflowDeviceTestCaseRecentRunEdge',
            node: {
              __typename: 'WorkflowDeviceTestCaseRecentRun',
              id: 'r2',
              status: WorkflowDeviceTestCaseStatus.Passed,
              durationMs: null,
              isFlaky: true,
              createdAt: '2026-09-02T09:00:00.000Z',
              workflowRunId: 'wr-2',
              workflowRunName: 'E2E #41',
              gitRef: null,
              commitSha: null,
            },
          },
        ],
        pageInfo: { __typename: 'PageInfo', hasNextPage: false },
        totalCount: 2,
      },
    },
  };
}

// The command widens the requested window out to whole buckets and drops daysBack, so a summary
// always carries bounds only.
const TIMESPAN = {
  startTime: '2026-08-26T00:00:00.000Z',
  endTime: '2026-09-02T00:00:00.000Z',
};
const SORT = { field: 'fails' as const, direction: 'desc' as const };

function makeSummary(overrides: Parameters<typeof makeApp>[0] = {}): MaestroInsightsSummary {
  return toMaestroInsightsSummary(makeApp(overrides), {
    timespan: TIMESPAN,
    granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity.Day,
    sort: SORT,
  });
}

function makeHistorySummary(
  app: AppWithMaestroFlowHistoryObject = makeHistoryApp()
): MaestroFlowHistorySummary {
  return toMaestroFlowHistorySummary(app, {
    flowPath: 'flows/login.yaml',
    timespan: TIMESPAN,
    granularity: WorkflowDeviceTestCaseInsightsTimeSeriesGranularity.Day,
  });
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe(toMaestroInsightsSummary, () => {
  it('derives the overview tiles the way the dashboard does', () => {
    const { totals } = makeSummary();

    expect(totals).toEqual({
      totalRuns: { current: 200, previous: 160 },
      passRatePercent: { current: 90, previous: 90 },
      distinctFlakyFlows: { current: 3, previous: 2 },
      avgDurationMs: { current: 42100, previous: null },
    });
  });

  it('keeps buckets as passed, flaky, and failed', () => {
    expect(makeSummary().runsOverTime[0]).toEqual({
      start: '2026-09-01T00:00:00.000Z',
      passedClean: 100,
      flaky: 5,
      failed: 10,
    });
  });

  it('derives per-flow rates and keeps unknown durations as null', () => {
    const summary = makeSummary();

    expect(summary.flows[0]).toEqual({
      path: 'flows/login.yaml',
      name: 'Login',
      totalRuns: 120,
      passRatePercent: 90,
      failed: 12,
      flakeRatePercent: summary.flows[0].flakeRatePercent,
      p90DurationMs: 70000,
      lastRunAt: '2026-09-02T10:30:00.000Z',
      lastRunStatus: 'FAILED',
      lastRunIsFlaky: false,
    });
    expect(summary.flows[0].flakeRatePercent).toBeCloseTo(6.67, 2);
    expect(summary.flows[1].p90DurationMs).toBeNull();
    expect(summary.totalFlows).toBe(5);
    expect(summary.hasMoreFlows).toBe(true);
    expect(summary.sort).toEqual(SORT);
  });
});

describe(buildMaestroInsightsJson, () => {
  it('builds the JSON payload', () => {
    const json = buildMaestroInsightsJson(makeSummary()) as any;

    expect(json.project).toBe('@acme/app');
    expect(json.timespan).toEqual({
      start: TIMESPAN.startTime,
      end: TIMESPAN.endTime,
    });
    expect(json.filters).toBeUndefined();
    expect(Object.keys(json.totals)).toEqual([
      'totalRuns',
      'passRatePercent',
      'distinctFlakyFlows',
      'avgDurationMs',
    ]);
    expect(json.runsOverTime.granularity).toBe('DAY');
    expect(json.flows).toHaveLength(2);
    expect(json.flows[0].path).toBe('flows/login.yaml');
    expect(json.totalFlows).toBe(5);
    expect(json.hasMoreFlows).toBe(true);
    expect(json.sort).toEqual({ field: 'fails', direction: 'desc' });
  });
});

describe(buildMaestroInsightsTable, () => {
  it('renders the four overview tiles, runs over time, and the flows table', () => {
    const table = buildMaestroInsightsTable(makeSummary());

    expect(table).toContain('Maestro insights:');
    expect(table).toContain('@acme/app');
    expect(table).toContain('Maestro runs');
    expect(table).toContain('+25.0%');
    expect(table).toContain('Pass rate');
    expect(table).toContain('90.0%');
    expect(table).toContain('Flaky flows');
    expect(table).toContain('Avg duration');
    expect(table).toContain('42.1s');
    const overview = table.slice(table.indexOf('Overview'), table.indexOf('Runs over time'));
    expect(overview).not.toContain('Flake rate');
    expect(overview).not.toContain('P90');
    expect(overview).not.toContain('Passed');
    expect(table).toContain('Runs over time (daily, UTC):');
    expect(table).toContain('Flows (showing 2 of 5, sorted by fails desc):');
    expect(table).toContain('flows/login.yaml');
    expect(table).toContain('70.0s');
    expect(table).toContain('FAILED');
    expect(table).toContain('FLAKY');
  });

  it('omits buckets with no runs and says so in the heading', () => {
    const bucket = (day: string, passedClean: number): (typeof timeSeries)[number] => ({
      __typename: 'WorkflowDeviceTestCaseInsightsBucket',
      bucketStartAt: `2026-08-${day}T00:00:00.000Z`,
      passedClean,
      flaky: 0,
      failed: 0,
    });
    const table = buildMaestroInsightsTable(
      makeSummary({ timeSeries: [bucket('27', 10), bucket('28', 0), bucket('29', 4)] })
    );

    expect(table).toContain('Runs over time (daily, UTC; days with no runs omitted):');
    expect(table).toContain('2026-08-27');
    expect(table).not.toContain('2026-08-28');
    expect(table).toContain('2026-08-29');
  });

  it('skips the runs-over-time table when no bucket has a run', () => {
    const summary = makeSummary({
      flows: [],
      timeSeries: timeSeries.map(bucket => ({ ...bucket, passedClean: 0, flaky: 0, failed: 0 })),
    });
    const table = buildMaestroInsightsTable(summary);

    expect(table).toContain('No flows matched in this time range.');
    expect(table).not.toContain('Runs over time');
    expect((buildMaestroInsightsJson(summary) as any).runsOverTime.buckets).toHaveLength(2);
  });

  it('says so when no flow ran', () => {
    const table = buildMaestroInsightsTable(makeSummary({ flows: [], hasNextPage: false }));

    expect(table).toContain('No flows matched in this time range.');
  });
});

describe(toMaestroFlowHistorySummary, () => {
  it('derives the detail tiles without a previous-period comparison', () => {
    const summary = makeHistorySummary();

    expect(summary.flowPath).toBe('flows/login.yaml');
    expect(summary.totals).toEqual({
      totalRuns: 200,
      passRatePercent: 90,
      flakyRuns: 10,
      p90DurationMs: 72000,
    });
    expect(summary.errorPatterns).toEqual([
      { count: 7, sampleMessage: 'Element not found:\n  id "login-button"' },
    ]);
    expect(summary.recentRuns[1]).toEqual({
      id: 'r2',
      status: 'PASSED',
      isFlaky: true,
      durationMs: null,
      createdAt: '2026-09-02T09:00:00.000Z',
      workflowRunId: 'wr-2',
      workflowRunName: 'E2E #41',
      gitRef: null,
      commitSha: null,
    });
    expect(summary.totalRecentRuns).toBe(2);
    expect(summary.hasMoreRecentRuns).toBe(false);
  });
});

describe(buildMaestroFlowHistoryJson, () => {
  it('includes the flow path and the history sections', () => {
    const json = buildMaestroFlowHistoryJson(makeHistorySummary()) as any;

    expect(json.flow).toBe('flows/login.yaml');
    expect(json.totals).toEqual({
      totalRuns: 200,
      passRatePercent: 90,
      flakyRuns: 10,
      p90DurationMs: 72000,
    });
    expect(json.errorPatterns).toHaveLength(1);
    expect(json.recentRuns).toHaveLength(2);
    expect(json.totalRecentRuns).toBe(2);
  });
});

describe(buildMaestroFlowHistoryTable, () => {
  it('renders the flow header, detail tiles, error patterns, and recent runs', () => {
    const table = buildMaestroFlowHistoryTable(makeHistorySummary());

    expect(table).toContain('Maestro flow insights:');
    expect(table).toContain('flows/login.yaml');
    expect(stripAnsi(table)).toMatch(/Maestro runs\s+200/);
    expect(stripAnsi(table)).toMatch(/Pass rate\s+90\.0%/);
    expect(stripAnsi(table)).toMatch(/Flaky runs\s+10/);
    expect(stripAnsi(table)).toMatch(/P90 duration\s+72\.0s/);
    expect(table).not.toContain('previous period');
    expect(table).not.toContain('Flaky flows');
    expect(table).toContain('Error patterns (top 1):');
    expect(table).toContain('Element not found: id "login-button"');
    expect(table).toContain('Recent runs (2):');
    expect(table).toContain('41.0s');
    expect(table).toContain('abcdef1');
    expect(table).toContain('E2E #42 (wr-1)');
    expect(table).toContain('FLAKY');
  });

  it('collapses and truncates long error messages to one line', () => {
    const app = makeHistoryApp();
    app.workflowDeviceTestCaseHistory.errorPatterns[0].sampleMessage = `Assertion failed:\n${'x'.repeat(200)}`;
    const table = buildMaestroFlowHistoryTable(makeHistorySummary(app));

    const line = table.split('\n').find(l => l.includes('Assertion failed:'));
    expect(line).toBeDefined();
    expect(line).toContain('Assertion failed: xxx');
    expect(line).toContain('…');
    expect(line!.length).toBeLessThan(160);
  });

  it('shows n/a for the pass rate when the flow has no runs', () => {
    const app = makeHistoryApp();
    app.workflowDeviceTestCaseHistory.totals.totalRuns.currentValue = 0;
    app.workflowDeviceTestCaseHistory.totals.passedCleanCount.currentValue = 0;
    app.workflowDeviceTestCaseHistory.totals.flakyCount.currentValue = 0;

    expect(stripAnsi(buildMaestroFlowHistoryTable(makeHistorySummary(app)))).toMatch(
      /Pass rate\s+n\/a/
    );
  });
});

describe(formatDurationMs, () => {
  it('formats like the dashboard', () => {
    expect(formatDurationMs(null)).toBe('n/a');
    expect(formatDurationMs(850)).toBe('850ms');
    expect(formatDurationMs(42100)).toBe('42.1s');
  });
});
