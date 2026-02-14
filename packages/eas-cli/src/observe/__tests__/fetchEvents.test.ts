import { AppObserveEventsOrderByDirection, AppObserveEventsOrderByField, AppObservePlatform } from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveEventsAsync, resolveMetricName, resolveOrderBy } from '../fetchEvents';

jest.mock('../../graphql/queries/ObserveQuery');

describe(resolveOrderBy, () => {
  it('maps "slowest" to METRIC_VALUE DESC', () => {
    expect(resolveOrderBy('slowest')).toEqual({
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('maps "fastest" to METRIC_VALUE ASC', () => {
    expect(resolveOrderBy('fastest')).toEqual({
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Asc,
    });
  });

  it('maps "newest" to TIMESTAMP DESC', () => {
    expect(resolveOrderBy('newest')).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('maps "oldest" to TIMESTAMP ASC', () => {
    expect(resolveOrderBy('oldest')).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Asc,
    });
  });
});

describe(resolveMetricName, () => {
  it('resolves short alias "tti" to full metric name', () => {
    expect(resolveMetricName('tti')).toBe('expo.app_startup.tti');
  });

  it('resolves short alias "ttr" to full metric name', () => {
    expect(resolveMetricName('ttr')).toBe('expo.app_startup.ttr');
  });

  it('resolves short alias "cold_launch" to full metric name', () => {
    expect(resolveMetricName('cold_launch')).toBe('expo.app_startup.cold_launch_time');
  });

  it('resolves short alias "warm_launch" to full metric name', () => {
    expect(resolveMetricName('warm_launch')).toBe('expo.app_startup.warm_launch_time');
  });

  it('resolves short alias "bundle_load" to full metric name', () => {
    expect(resolveMetricName('bundle_load')).toBe('expo.app_startup.bundle_load_time');
  });

  it('passes through full metric names unchanged', () => {
    expect(resolveMetricName('expo.app_startup.tti')).toBe('expo.app_startup.tti');
    expect(resolveMetricName('expo.app_startup.cold_launch_time')).toBe('expo.app_startup.cold_launch_time');
  });

  it('throws on unknown alias', () => {
    expect(() => resolveMetricName('unknown_metric')).toThrow(
      'Unknown metric: "unknown_metric"'
    );
  });

  it('passes through dot-containing custom metric names', () => {
    expect(resolveMetricName('custom.metric.name')).toBe('custom.metric.name');
  });
});

describe(fetchObserveEventsAsync, () => {
  const mockEventsAsync = jest.mocked(ObserveQuery.eventsAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockEventsAsync.mockClear();
  });

  it('calls ObserveQuery.eventsAsync with assembled filter', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: { field: AppObserveEventsOrderByField.MetricValue, direction: AppObserveEventsOrderByDirection.Desc },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(mockEventsAsync).toHaveBeenCalledTimes(1);
    expect(mockEventsAsync).toHaveBeenCalledWith(mockGraphqlClient, {
      appId: 'app-123',
      filter: {
        metricName: 'expo.app_startup.tti',
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-03-01T00:00:00.000Z',
      },
      first: 10,
      orderBy: { field: AppObserveEventsOrderByField.MetricValue, direction: AppObserveEventsOrderByDirection.Desc },
    });
  });

  it('includes platform in filter when provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: { field: AppObserveEventsOrderByField.MetricValue, direction: AppObserveEventsOrderByDirection.Desc },
      limit: 5,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platform: AppObservePlatform.Ios,
    });

    expect(mockEventsAsync).toHaveBeenCalledWith(mockGraphqlClient, expect.objectContaining({
      filter: expect.objectContaining({
        platform: AppObservePlatform.Ios,
      }),
    }));
  });

  it('includes appVersion in filter when provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: { field: AppObserveEventsOrderByField.MetricValue, direction: AppObserveEventsOrderByDirection.Desc },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      appVersion: '1.2.0',
    });

    expect(mockEventsAsync).toHaveBeenCalledWith(mockGraphqlClient, expect.objectContaining({
      filter: expect.objectContaining({
        appVersion: '1.2.0',
      }),
    }));
  });

  it('omits platform and appVersion from filter when not provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: { field: AppObserveEventsOrderByField.MetricValue, direction: AppObserveEventsOrderByDirection.Desc },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const calledFilter = mockEventsAsync.mock.calls[0][1].filter;
    expect(calledFilter).not.toHaveProperty('platform');
    expect(calledFilter).not.toHaveProperty('appVersion');
  });

  it('returns events and pageInfo from the query result', async () => {
    const mockEvents = [
      {
        __typename: 'AppObserveEvent' as const,
        id: 'evt-1',
        metricName: 'expo.app_startup.tti',
        metricValue: 1.23,
        timestamp: '2025-01-15T10:30:00.000Z',
        appVersion: '1.0.0',
        appBuildNumber: '42',
        deviceModel: 'iPhone 15',
        deviceOs: 'iOS',
        deviceOsVersion: '17.0',
        countryCode: 'US',
        sessionId: 'session-1',
        easClientId: 'client-1',
      },
    ];
    mockEventsAsync.mockResolvedValue({
      events: mockEvents as any,
      pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'cursor-1' },
    });

    const result = await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: { field: AppObserveEventsOrderByField.MetricValue, direction: AppObserveEventsOrderByDirection.Desc },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].metricValue).toBe(1.23);
    expect(result.pageInfo.hasNextPage).toBe(true);
  });
});
