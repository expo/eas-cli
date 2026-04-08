import { AppObservePlatform, AppPlatform } from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { makeMetricsKey } from '../formatMetrics';
import { fetchObserveMetricsAsync } from '../fetchMetrics';

jest.mock('../../graphql/queries/ObserveQuery');
jest.mock('../../log');

describe('fetchObserveMetricsAsync', () => {
  const mockTimeSeriesAsync = jest.mocked(ObserveQuery.timeSeriesAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockTimeSeriesAsync.mockClear();
  });

  it('fans out queries for each metric+platform combo and assembles metricsMap', async () => {
    mockTimeSeriesAsync.mockImplementation(async (_client, { metricName, platform }) => {
      if (metricName === 'expo.app_startup.tti' && platform === AppObservePlatform.Ios) {
        return {
          appVersionMarkers: [
            {
              __typename: 'AppObserveAppVersion' as const,
              appVersion: '1.0.0',
              eventCount: 100,
              uniqueUserCount: 50,
              firstSeenAt: '2025-01-01T00:00:00.000Z',
              buildNumbers: [],
              updates: [],
            },
          ],
          eventCount: 100,
          statistics: {
            __typename: 'AppObserveTimeSeriesStatistics' as const,
            count: 100,
            min: 0.01,
            max: 0.5,
            median: 0.1,
            average: 0.15,
            p80: 0.3,
            p90: 0.4,
            p99: 0.48,
          },
        };
      }
      if (
        metricName === 'expo.app_startup.cold_launch_time' &&
        platform === AppObservePlatform.Ios
      ) {
        return {
          appVersionMarkers: [
            {
              __typename: 'AppObserveAppVersion' as const,
              appVersion: '1.0.0',
              eventCount: 80,
              uniqueUserCount: 40,
              firstSeenAt: '2025-01-01T00:00:00.000Z',
              buildNumbers: [],
              updates: [],
            },
          ],
          eventCount: 80,
          statistics: {
            __typename: 'AppObserveTimeSeriesStatistics' as const,
            count: 80,
            min: 0.05,
            max: 1.2,
            median: 0.3,
            average: 0.4,
            p80: 0.8,
            p90: 1.0,
            p99: 1.15,
          },
        };
      }
      return {
        appVersionMarkers: [],
        eventCount: 0,
        statistics: {
          __typename: 'AppObserveTimeSeriesStatistics' as const,
          count: 0,
          min: null,
          max: null,
          median: null,
          average: null,
          p80: null,
          p90: null,
          p99: null,
        },
      };
    });

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti', 'expo.app_startup.cold_launch_time'],
      [AppPlatform.Ios],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    // Should have called the query twice (2 metrics x 1 platform)
    expect(mockTimeSeriesAsync).toHaveBeenCalledTimes(2);

    // Verify metricsMap was assembled correctly
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
    mockTimeSeriesAsync.mockResolvedValue({
      appVersionMarkers: [],
      eventCount: 0,
      statistics: {
        __typename: 'AppObserveTimeSeriesStatistics' as const,
        count: 0,
        min: null,
        max: null,
        median: null,
        average: null,
        p80: null,
        p90: null,
        p99: null,
      },
    });

    await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Ios, AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    // 1 metric x 2 platforms = 2 calls
    expect(mockTimeSeriesAsync).toHaveBeenCalledTimes(2);

    const platforms = mockTimeSeriesAsync.mock.calls.map(call => call[1].platform);
    expect(platforms).toContain(AppObservePlatform.Ios);
    expect(platforms).toContain(AppObservePlatform.Android);
  });

  it('handles partial failures gracefully — successful queries still populate metricsMap', async () => {
    mockTimeSeriesAsync.mockImplementation(async (_client, { metricName }) => {
      if (metricName === 'bad.metric') {
        throw new Error('Unknown metric');
      }
      return {
        appVersionMarkers: [
          {
            __typename: 'AppObserveAppVersion' as const,
            appVersion: '2.0.0',
            eventCount: 50,
            uniqueUserCount: 25,
            firstSeenAt: '2025-01-01T00:00:00.000Z',
            buildNumbers: [],
            updates: [],
          },
        ],
        eventCount: 50,
        statistics: {
          __typename: 'AppObserveTimeSeriesStatistics' as const,
          count: 50,
          min: 0.1,
          max: 0.9,
          median: 0.5,
          average: 0.5,
          p80: 0.7,
          p90: 0.8,
          p99: 0.85,
        },
      };
    });

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti', 'bad.metric'],
      [AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    // Should not throw; the good metric should still be in the map
    const key = makeMetricsKey('2.0.0', AppPlatform.Android);
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
    // The bad metric should not be present
    expect(metricsMap.get(key)!.has('bad.metric')).toBe(false);
  });

  it('returns empty map when all queries fail', async () => {
    mockTimeSeriesAsync.mockRejectedValue(new Error('Network error'));

    const metricsMap = await fetchObserveMetricsAsync(
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
    mockTimeSeriesAsync.mockResolvedValue({
      appVersionMarkers: [
        {
          __typename: 'AppObserveAppVersion' as const,
          appVersion: '3.0.0',
          eventCount: 10,
          uniqueUserCount: 5,
          firstSeenAt: '2025-01-01T00:00:00.000Z',
          buildNumbers: [],
          updates: [],
        },
      ],
      eventCount: 10,
      statistics: {
        __typename: 'AppObserveTimeSeriesStatistics' as const,
        count: 10,
        min: 0.1,
        max: 0.2,
        median: 0.15,
        average: 0.15,
        p80: 0.18,
        p90: 0.19,
        p99: 0.2,
      },
    });

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    // The key should use AppPlatform (ANDROID), not AppObservePlatform
    expect(metricsMap.has('3.0.0:ANDROID')).toBe(true);
    expect(metricsMap.has('3.0.0:Android' as any)).toBe(false);
  });
});
