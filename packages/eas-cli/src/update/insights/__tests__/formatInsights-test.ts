import { UpdateWithInsightsObject } from '../../../graphql/queries/UpdateInsightsQuery';
import {
  buildUpdateInsightsJson,
  buildUpdateInsightsTable,
  formatBytes,
  formatPercent,
  toUpdateInsightsSummary,
} from '../formatInsights';

function makeUpdate(
  platform: string,
  overrides: {
    updateId?: string;
    totalInstalls?: number;
    totalFailedInstalls?: number;
    totalUniqueUsers?: number;
    launchAssetCount?: number;
    averageUpdatePayloadBytes?: number;
    labels?: string[];
    installsDifference?: number[];
    failedInstallsDifference?: number[];
  } = {}
): UpdateWithInsightsObject {
  const labels = overrides.labels ?? ['2026-04-09', '2026-04-10'];
  const installsDifference = overrides.installsDifference ?? [10, 20];
  const failedInstallsDifference = overrides.failedInstallsDifference ?? [1, 2];
  return {
    __typename: 'Update',
    id: overrides.updateId ?? `${platform}-update`,
    platform,
    insights: {
      __typename: 'UpdateInsights',
      id: `${platform}-insights`,
      totalUniqueUsers: overrides.totalUniqueUsers ?? 100,
      cumulativeAverageMetrics: {
        __typename: 'CumulativeAverageMetrics',
        launchAssetCount: overrides.launchAssetCount ?? 3,
        averageUpdatePayloadBytes: overrides.averageUpdatePayloadBytes ?? 5_000_000,
      },
      cumulativeMetrics: {
        __typename: 'CumulativeMetrics',
        metricsAtLastTimestamp: {
          __typename: 'CumulativeMetricsTotals',
          totalInstalls: overrides.totalInstalls ?? 1000,
          totalFailedInstalls: overrides.totalFailedInstalls ?? 10,
        },
        data: {
          __typename: 'UpdatesMetricsData',
          labels,
          installsDataset: {
            __typename: 'CumulativeUpdatesDataset',
            id: `${platform}-installs`,
            label: 'Installs',
            cumulative: installsDifference.map((_, i) =>
              installsDifference.slice(0, i + 1).reduce((a, b) => a + b, 0)
            ),
            difference: installsDifference,
          },
          failedInstallsDataset: {
            __typename: 'CumulativeUpdatesDataset',
            id: `${platform}-failed`,
            label: 'Failed installs',
            cumulative: failedInstallsDifference.map((_, i) =>
              failedInstallsDifference.slice(0, i + 1).reduce((a, b) => a + b, 0)
            ),
            difference: failedInstallsDifference,
          },
        },
      },
    },
  };
}

const TIMESPAN = {
  startTime: '2026-04-09T00:00:00.000Z',
  endTime: '2026-04-16T00:00:00.000Z',
  daysBack: 7,
};

describe(toUpdateInsightsSummary, () => {
  it('sorts platforms alphabetically', () => {
    const summary = toUpdateInsightsSummary(
      'group-1',
      [makeUpdate('ios'), makeUpdate('android')],
      TIMESPAN
    );
    expect(summary.platforms.map(p => p.platform)).toEqual(['android', 'ios']);
  });

  it('computes crash rate per platform', () => {
    const summary = toUpdateInsightsSummary(
      'group-1',
      [
        makeUpdate('android', { totalInstalls: 100, totalFailedInstalls: 5 }),
        makeUpdate('ios', { totalInstalls: 990, totalFailedInstalls: 10 }),
      ],
      TIMESPAN
    );
    expect(summary.platforms[0].crashRatePercent).toBeCloseTo((5 / 105) * 100, 5);
    expect(summary.platforms[1].crashRatePercent).toBeCloseTo((10 / 1000) * 100, 5);
  });

  it('returns 0 crash rate when both install counts are zero', () => {
    const summary = toUpdateInsightsSummary(
      'group-1',
      [
        makeUpdate('android', {
          totalInstalls: 0,
          totalFailedInstalls: 0,
          installsDifference: [],
          failedInstallsDifference: [],
          labels: [],
        }),
      ],
      TIMESPAN
    );
    expect(summary.platforms[0].crashRatePercent).toBe(0);
  });

  it('maps daily breakdown per platform from labels and difference datasets', () => {
    const summary = toUpdateInsightsSummary(
      'group-1',
      [
        makeUpdate('ios', {
          labels: ['2026-04-09', '2026-04-10'],
          installsDifference: [50, 75],
          failedInstallsDifference: [1, 3],
        }),
      ],
      TIMESPAN
    );
    expect(summary.platforms[0].daily).toEqual([
      { date: '2026-04-09', installs: 50, failedInstalls: 1 },
      { date: '2026-04-10', installs: 75, failedInstalls: 3 },
    ]);
  });

  it('captures platform-specific updateId', () => {
    const summary = toUpdateInsightsSummary(
      'group-1',
      [
        makeUpdate('android', { updateId: 'android-id' }),
        makeUpdate('ios', { updateId: 'ios-id' }),
      ],
      TIMESPAN
    );
    expect(summary.platforms.find(p => p.platform === 'android')?.updateId).toBe('android-id');
    expect(summary.platforms.find(p => p.platform === 'ios')?.updateId).toBe('ios-id');
  });
});

describe(buildUpdateInsightsJson, () => {
  it('returns a serializable object with per-platform totals, payload, and daily', () => {
    const summary = toUpdateInsightsSummary(
      'group-1',
      [makeUpdate('android'), makeUpdate('ios', { totalInstalls: 500, totalFailedInstalls: 5 })],
      TIMESPAN
    );
    const json = buildUpdateInsightsJson(summary) as any;
    expect(json.groupId).toBe('group-1');
    expect(json.timespan.daysBack).toBe(7);
    expect(json.platforms).toHaveLength(2);
    expect(json.platforms[0].platform).toBe('android');
    expect(json.platforms[1].platform).toBe('ios');
    expect(json.platforms[1].totals.installs).toBe(500);
    expect(json.platforms[0].daily).toHaveLength(2);
  });
});

describe(buildUpdateInsightsTable, () => {
  it('renders per-platform sections with totals, crash rate and daily breakdown', () => {
    const summary = toUpdateInsightsSummary(
      'group-1',
      [makeUpdate('android'), makeUpdate('ios')],
      TIMESPAN
    );
    const table = buildUpdateInsightsTable(summary);
    expect(table).toMatch(/group-1/);
    expect(table).toMatch(/Platforms/);
    expect(table).toMatch(/android, ios/);
    expect(table).toMatch(/\bandroid\b/);
    expect(table).toMatch(/\bios\b/);
    expect(table).toMatch(/Launches/);
    expect(table).toMatch(/Crash rate/);
    expect(table).toMatch(/Daily breakdown/);
    expect(table).toMatch(/2026-04-09/);
  });
});

describe(formatBytes, () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
  it('formats megabytes', () => {
    expect(formatBytes(5_242_880)).toBe('5.00 MB');
  });
});

describe(formatPercent, () => {
  it('formats with two decimal places', () => {
    expect(formatPercent(12.3456)).toBe('12.35%');
  });
});
