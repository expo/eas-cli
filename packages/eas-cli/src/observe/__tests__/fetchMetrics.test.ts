import { AppObservePlatform, AppPlatform } from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { makeMetricsKey } from '../formatMetrics';
import { fetchObserveMetricsAsync } from '../fetchMetrics';

jest.mock('../../graphql/queries/ObserveQuery');
jest.mock('../../log');

function makeAppVersion(
  appVersion: string,
  metrics: Array<{
    metricName: string;
    eventCount: number;
    statistics: {
      min: number;
      max: number;
      median: number;
      average: number;
      p80: number;
      p90: number;
      p99: number;
    };
  }>
) {
  return {
    __typename: 'AppObserveAppVersion' as const,
    appVersion,
    eventCount: metrics.reduce((sum, m) => sum + m.eventCount, 0),
    uniqueUserCount: 50,
    firstSeenAt: '2025-01-01T00:00:00.000Z',
    buildNumbers: [],
    updates: [],
    metrics: metrics.map(m => ({
      __typename: 'AppObserveAppVersionMetric' as const,
      ...m,
      statistics: {
        __typename: 'AppObserveVersionMarkerStatistics' as const,
        ...m.statistics,
      },
    })),
  };
}

describe('fetchObserveMetricsAsync', () => {
  const mockAppVersionsAsync = jest.mocked(ObserveQuery.appVersionsAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockAppVersionsAsync.mockClear();
  });

  it('fetches app versions with metricNames and assembles metricsMap', async () => {
    mockAppVersionsAsync.mockResolvedValue([
      makeAppVersion('1.0.0', [
        {
          metricName: 'expo.app_startup.tti',
          eventCount: 100,
          statistics: {
            min: 0.01,
            max: 0.5,
            median: 0.1,
            average: 0.15,
            p80: 0.3,
            p90: 0.4,
            p99: 0.48,
          },
        },
        {
          metricName: 'expo.app_startup.cold_launch_time',
          eventCount: 80,
          statistics: {
            min: 0.05,
            max: 1.2,
            median: 0.3,
            average: 0.4,
            p80: 0.8,
            p90: 1.0,
            p99: 1.15,
          },
        },
      ]),
    ]);

    const { metricsMap } = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti', 'expo.app_startup.cold_launch_time'],
      [AppPlatform.Ios],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(mockAppVersionsAsync).toHaveBeenCalledTimes(1);
    expect(mockAppVersionsAsync).toHaveBeenCalledWith(mockGraphqlClient, {
      appId: 'project-123',
      platform: AppObservePlatform.Ios,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      metricNames: ['expo.app_startup.tti', 'expo.app_startup.cold_launch_time'],
    });

    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    expect(metricsMap.has(key)).toBe(true);

    const metricsForVersion = metricsMap.get(key)!;
    expect(metricsForVersion.get('expo.app_startup.tti')).toEqual({
      min: 0.01,
      max: 0.5,
      median: 0.1,
      average: 0.15,
      p80: 0.3,
      p90: 0.4,
      p99: 0.48,
      eventCount: 100,
    });
    expect(metricsForVersion.get('expo.app_startup.cold_launch_time')).toEqual({
      min: 0.05,
      max: 1.2,
      median: 0.3,
      average: 0.4,
      p80: 0.8,
      p90: 1.0,
      p99: 1.15,
      eventCount: 80,
    });
  });

  it('fans out across multiple platforms', async () => {
    mockAppVersionsAsync.mockResolvedValue([]);

    await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Ios, AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(mockAppVersionsAsync).toHaveBeenCalledTimes(2);

    const platforms = mockAppVersionsAsync.mock.calls.map(call => call[1].platform);
    expect(platforms).toContain(AppObservePlatform.Ios);
    expect(platforms).toContain(AppObservePlatform.Android);
  });

  it('handles partial failures gracefully', async () => {
    mockAppVersionsAsync.mockImplementation(async (_client, { platform }) => {
      if (platform === AppObservePlatform.Android) {
        throw new Error('Network error');
      }
      return [
        makeAppVersion('2.0.0', [
          {
            metricName: 'expo.app_startup.tti',
            eventCount: 50,
            statistics: {
              min: 0.1,
              max: 0.9,
              median: 0.5,
              average: 0.5,
              p80: 0.7,
              p90: 0.8,
              p99: 0.85,
            },
          },
        ]),
      ];
    });

    const { metricsMap } = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Ios, AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    const key = makeMetricsKey('2.0.0', AppPlatform.Ios);
    expect(metricsMap.has(key)).toBe(true);
    expect(metricsMap.get(key)!.get('expo.app_startup.tti')).toEqual({
      min: 0.1,
      max: 0.9,
      median: 0.5,
      average: 0.5,
      p80: 0.7,
      p90: 0.8,
      p99: 0.85,
      eventCount: 50,
    });
  });

  it('returns empty map when all queries fail', async () => {
    mockAppVersionsAsync.mockRejectedValue(new Error('Network error'));

    const { metricsMap } = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Ios],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(metricsMap.size).toBe(0);
  });

  it('maps AppObservePlatform back to AppPlatform correctly in metricsMap keys', async () => {
    mockAppVersionsAsync.mockResolvedValue([
      makeAppVersion('3.0.0', [
        {
          metricName: 'expo.app_startup.tti',
          eventCount: 10,
          statistics: {
            min: 0.1,
            max: 0.2,
            median: 0.15,
            average: 0.15,
            p80: 0.18,
            p90: 0.19,
            p99: 0.2,
          },
        },
      ]),
    ]);

    const { metricsMap } = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(metricsMap.has('3.0.0:ANDROID')).toBe(true);
    expect(metricsMap.has('3.0.0:Android' as any)).toBe(false);
  });

  it('accumulates totalEventCounts per metric per platform', async () => {
    mockAppVersionsAsync.mockResolvedValue([
      makeAppVersion('1.0.0', [
        {
          metricName: 'expo.app_startup.tti',
          eventCount: 100,
          statistics: { min: 0, max: 1, median: 0.5, average: 0.5, p80: 0.8, p90: 0.9, p99: 0.95 },
        },
      ]),
      makeAppVersion('2.0.0', [
        {
          metricName: 'expo.app_startup.tti',
          eventCount: 50,
          statistics: { min: 0, max: 1, median: 0.5, average: 0.5, p80: 0.8, p90: 0.9, p99: 0.95 },
        },
      ]),
    ]);

    const { totalEventCounts } = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Ios],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(totalEventCounts.get('expo.app_startup.tti:IOS')).toBe(150);
  });
});
