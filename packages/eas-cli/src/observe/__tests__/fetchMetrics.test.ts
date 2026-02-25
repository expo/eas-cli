import { AppObservePlatform, AppPlatform } from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { makeMetricsKey } from '../formatMetrics';
import { fetchObserveMetricsAsync } from '../fetchMetrics';

jest.mock('../../graphql/queries/ObserveQuery');
jest.mock('../../log');

const SIMPLE_MARKER = {
  __typename: 'AppObserveVersionMarker' as const,
  appVersion: '1.0.0',
  eventCount: 100,
  firstSeenAt: '2025-01-01T00:00:00.000Z',
  statistics: {
    __typename: 'AppObserveVersionMarkerStatistics' as const,
    min: 0.1,
    max: 0.5,
    median: 0.2,
    average: 0.3,
    p80: 0.35,
    p90: 0.4,
    p99: 0.48,
  },
};

describe('fetchObserveMetricsAsync', () => {
  const mockTimeSeriesMarkers = jest.mocked(ObserveQuery.timeSeriesVersionMarkersAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockTimeSeriesMarkers.mockClear();
  });

  it('fans out queries for each metric+platform combo and assembles metricsMap', async () => {
    mockTimeSeriesMarkers
      .mockResolvedValueOnce([{ ...SIMPLE_MARKER, eventCount: 100 }])
      .mockResolvedValueOnce([{ ...SIMPLE_MARKER, eventCount: 80 }]);

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti', 'expo.app_startup.cold_launch_time'],
      [AppPlatform.Ios],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(mockTimeSeriesMarkers).toHaveBeenCalledTimes(2);
    expect(mockTimeSeriesMarkers).toHaveBeenNthCalledWith(1, mockGraphqlClient, {
      appId: 'project-123',
      metricName: 'expo.app_startup.tti',
      platform: AppObservePlatform.Ios,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });
    expect(mockTimeSeriesMarkers).toHaveBeenNthCalledWith(2, mockGraphqlClient, {
      appId: 'project-123',
      metricName: 'expo.app_startup.cold_launch_time',
      platform: AppObservePlatform.Ios,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    const metricsForVersion = metricsMap.get(key)!;
    expect(metricsForVersion.get('expo.app_startup.tti')).toEqual(
      expect.objectContaining({ eventCount: 100, min: 0.1, p99: 0.48 })
    );
    expect(metricsForVersion.get('expo.app_startup.cold_launch_time')).toEqual(
      expect.objectContaining({ eventCount: 80 })
    );
  });

  it('fans out across multiple platforms', async () => {
    mockTimeSeriesMarkers.mockResolvedValue([]);

    await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti'],
      [AppPlatform.Ios, AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(mockTimeSeriesMarkers).toHaveBeenCalledTimes(2);
    expect(mockTimeSeriesMarkers).toHaveBeenNthCalledWith(1, mockGraphqlClient, {
      appId: 'project-123',
      metricName: 'expo.app_startup.tti',
      platform: AppObservePlatform.Ios,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });
    expect(mockTimeSeriesMarkers).toHaveBeenNthCalledWith(2, mockGraphqlClient, {
      appId: 'project-123',
      metricName: 'expo.app_startup.tti',
      platform: AppObservePlatform.Android,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });
  });

  it('handles partial failures gracefully - successful queries still populate metricsMap', async () => {
    mockTimeSeriesMarkers
      .mockResolvedValueOnce([SIMPLE_MARKER])
      .mockRejectedValueOnce(new Error('Unknown metric'));

    const metricsMap = await fetchObserveMetricsAsync(
      mockGraphqlClient,
      'project-123',
      ['expo.app_startup.tti', 'bad.metric'],
      [AppPlatform.Android],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    const key = makeMetricsKey('1.0.0', AppPlatform.Android);
    expect(metricsMap.get(key)!.has('expo.app_startup.tti')).toBe(true);
    expect(metricsMap.get(key)!.has('bad.metric')).toBe(false);
  });

  it('returns empty map when all queries fail', async () => {
    mockTimeSeriesMarkers.mockRejectedValue(new Error('Network error'));

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
    mockTimeSeriesMarkers.mockResolvedValue([{ ...SIMPLE_MARKER, appVersion: '3.0.0' }]);

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