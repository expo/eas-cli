import { AppObservePlatform, AppPlatform } from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { makeMetricsKey } from '../formatMetrics';
import { fetchObserveMetricsAsync } from '../fetchMetrics';

jest.mock('../../graphql/queries/ObserveQuery');

describe('fetchObserveMetricsAsync', () => {
  const mockTimeSeriesMarkers = jest.mocked(ObserveQuery.timeSeriesVersionMarkersAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockTimeSeriesMarkers.mockClear();
  });

  it('fans out queries for each metric+platform combo and assembles metricsMap', async () => {
    mockTimeSeriesMarkers.mockImplementation(async (_client, { metricName, platform }) => {
      if (metricName === 'expo.app_startup.tti' && platform === AppObservePlatform.Ios) {
        return [{
          __typename: 'AppObserveVersionMarker' as const,
          appVersion: '1.0.0',
          eventCount: 100,
          firstSeenAt: '2025-01-01T00:00:00.000Z',
          statistics: { __typename: 'AppObserveVersionMarkerStatistics' as const, min: 0.01, max: 0.5, median: 0.1 },
        }];
      }
      if (metricName === 'expo.app_startup.cold_launch_time' && platform === AppObservePlatform.Ios) {
        return [{
          __typename: 'AppObserveVersionMarker' as const,
          appVersion: '1.0.0',
          eventCount: 80,
          firstSeenAt: '2025-01-01T00:00:00.000Z',
          statistics: { __typename: 'AppObserveVersionMarkerStatistics' as const, min: 0.05, max: 1.2, median: 0.3 },
        }];
      }
      return [];
    });

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti', 'expo.app_startup.cold_launch_time'],
      new Set([AppPlatform.Ios]),
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    // Should have called the query twice (2 metrics x 1 platform)
    expect(mockTimeSeriesMarkers).toHaveBeenCalledTimes(2);

    // Verify metricsMap was assembled correctly
    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    expect(metricsMap.has(key)).toBe(true);

    const metricsForVersion = metricsMap.get(key)!;
    expect(metricsForVersion.get('expo.app_startup.tti')).toEqual({
      min: 0.01,
      max: 0.5,
      median: 0.1,
    });
    expect(metricsForVersion.get('expo.app_startup.cold_launch_time')).toEqual({
      min: 0.05,
      max: 1.2,
      median: 0.3,
    });
  });

  it('fans out across multiple platforms', async () => {
    mockTimeSeriesMarkers.mockResolvedValue([]);

    await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      new Set([AppPlatform.Ios, AppPlatform.Android]),
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    // 1 metric x 2 platforms = 2 calls
    expect(mockTimeSeriesMarkers).toHaveBeenCalledTimes(2);

    const platforms = mockTimeSeriesMarkers.mock.calls.map(call => call[1].platform);
    expect(platforms).toContain(AppObservePlatform.Ios);
    expect(platforms).toContain(AppObservePlatform.Android);
  });

  it('handles partial failures gracefully — successful queries still populate metricsMap', async () => {
    mockTimeSeriesMarkers.mockImplementation(async (_client, { metricName }) => {
      if (metricName === 'bad.metric') {
        throw new Error('Unknown metric');
      }
      return [{
        __typename: 'AppObserveVersionMarker' as const,
        appVersion: '2.0.0',
        eventCount: 50,
        firstSeenAt: '2025-01-01T00:00:00.000Z',
        statistics: { __typename: 'AppObserveVersionMarkerStatistics' as const, min: 0.1, max: 0.9, median: 0.5 },
      }];
    });

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti', 'bad.metric'],
      new Set([AppPlatform.Android]),
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
    });
    // The bad metric should not be present
    expect(metricsMap.get(key)!.has('bad.metric')).toBe(false);
  });

  it('returns empty map when all queries fail', async () => {
    mockTimeSeriesMarkers.mockRejectedValue(new Error('Network error'));

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      new Set([AppPlatform.Ios]),
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(metricsMap.size).toBe(0);
  });

  it('maps AppObservePlatform back to AppPlatform correctly in metricsMap keys', async () => {
    mockTimeSeriesMarkers.mockResolvedValue([{
      __typename: 'AppObserveVersionMarker' as const,
      appVersion: '3.0.0',
      eventCount: 10,
      firstSeenAt: '2025-01-01T00:00:00.000Z',
      statistics: { __typename: 'AppObserveVersionMarkerStatistics' as const, min: 0.1, max: 0.2, median: 0.15 },
    }]);

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      new Set([AppPlatform.Android]),
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    // The key should use AppPlatform (ANDROID), not AppObservePlatform
    expect(metricsMap.has('3.0.0:ANDROID')).toBe(true);
    expect(metricsMap.has('3.0.0:Android' as any)).toBe(false);
  });
});
