import { ChannelRuntimeInsights } from '../../../graphql/queries/ChannelInsightsQuery';
import {
  buildChannelInsightsJson,
  buildChannelInsightsTable,
  toChannelInsightsSummary,
} from '../formatInsights';

function makeInsights(
  overrides: {
    embeddedUpdateTotalUniqueUsers?: number;
    mostPopularUpdates?: {
      id: string;
      group: string;
      message: string | null;
      runtimeVersion: string;
      platform: string;
      totalUniqueUsers: number;
    }[];
  } = {}
): ChannelRuntimeInsights {
  return {
    __typename: 'UpdateChannelRuntimeInsights',
    id: 'rti-id',
    embeddedUpdateTotalUniqueUsers: overrides.embeddedUpdateTotalUniqueUsers ?? 250,
    mostPopularUpdates: (
      overrides.mostPopularUpdates ?? [
        {
          id: 'u1',
          group: 'group-a',
          message: 'first',
          runtimeVersion: '1.0.0',
          platform: 'ios',
          totalUniqueUsers: 800,
        },
        {
          id: 'u2',
          group: 'group-b',
          message: 'second',
          runtimeVersion: '1.0.0',
          platform: 'android',
          totalUniqueUsers: 200,
        },
      ]
    ).map(u => ({
      __typename: 'Update' as const,
      id: u.id,
      group: u.group,
      message: u.message,
      runtimeVersion: u.runtimeVersion,
      platform: u.platform,
      insights: {
        __typename: 'UpdateInsights' as const,
        id: `${u.id}-insights`,
        totalUniqueUsers: u.totalUniqueUsers,
      },
    })),
    uniqueUsersOverTime: {
      __typename: 'UniqueUsersOverTimeData',
      data: {
        __typename: 'LineChartData',
        labels: ['2026-04-09', '2026-04-10'],
        datasets: [{ __typename: 'LineDataset', id: 'd1', label: 'iOS', data: [100, 200] }],
      },
    },
    cumulativeMetricsOverTime: {
      __typename: 'ChannelRuntimeCumulativeMetricsOverTimeData',
      data: {
        __typename: 'LineChartData',
        labels: ['2026-04-09', '2026-04-10'],
        datasets: [{ __typename: 'LineDataset', id: 'cd1', label: 'Launches', data: [10, 20] }],
      },
      metricsAtLastTimestamp: [
        { __typename: 'LineDatapoint', id: 'launches', label: 'Launches', data: 1234 },
      ],
    },
  };
}

const TIMESPAN = {
  startTime: '2026-04-09T00:00:00.000Z',
  endTime: '2026-04-16T00:00:00.000Z',
  daysBack: 7,
};

describe(toChannelInsightsSummary, () => {
  it('ranks most popular updates by their order in the response', () => {
    const summary = toChannelInsightsSummary('production', '1.0.0', makeInsights(), TIMESPAN);
    expect(summary.mostPopularUpdates.map(u => u.rank)).toEqual([1, 2]);
    expect(summary.mostPopularUpdates[0].groupId).toBe('group-a');
  });

  it('sums OTA totalUniqueUsers across most popular updates', () => {
    const summary = toChannelInsightsSummary('production', '1.0.0', makeInsights(), TIMESPAN);
    expect(summary.otaTotalUniqueUsers).toBe(1000);
  });

  it('passes through embedded update unique users', () => {
    const summary = toChannelInsightsSummary(
      'production',
      '1.0.0',
      makeInsights({ embeddedUpdateTotalUniqueUsers: 42 }),
      TIMESPAN
    );
    expect(summary.embeddedUpdateTotalUniqueUsers).toBe(42);
  });
});

describe(buildChannelInsightsJson, () => {
  it('returns a serializable object', () => {
    const summary = toChannelInsightsSummary('production', '1.0.0', makeInsights(), TIMESPAN);
    const json = buildChannelInsightsJson(summary) as any;
    expect(json.channel).toBe('production');
    expect(json.runtimeVersion).toBe('1.0.0');
    expect(json.timespan.daysBack).toBe(7);
    expect(json.mostPopularUpdates).toHaveLength(2);
    expect(json.cumulativeMetricsAtLastTimestamp[0].label).toBe('Launches');
  });
});

describe(buildChannelInsightsTable, () => {
  it('renders channel, runtime, embedded users and most popular updates', () => {
    const summary = toChannelInsightsSummary('production', '1.0.0', makeInsights(), TIMESPAN);
    const table = buildChannelInsightsTable(summary);
    expect(table).toMatch(/Channel/);
    expect(table).toMatch(/production/);
    expect(table).toMatch(/1\.0\.0/);
    expect(table).toMatch(/Embedded update users/);
    expect(table).toMatch(/group-a/);
    expect(table).toMatch(/Most popular updates/);
  });

  it('shows a friendly message when there are no popular updates', () => {
    const summary = toChannelInsightsSummary(
      'production',
      '1.0.0',
      makeInsights({ mostPopularUpdates: [] }),
      TIMESPAN
    );
    const table = buildChannelInsightsTable(summary);
    expect(table).toMatch(/No update launches recorded/);
  });
});
