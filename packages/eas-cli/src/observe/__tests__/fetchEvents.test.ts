import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import {
  AppObserveEventsOrderByDirection,
  AppObserveEventsOrderByField,
  AppObservePlatform,
  AppPlatform,
} from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import {
  EventsOrderPreset,
  fetchObserveEventsAsync,
  fetchTotalEventCountAsync,
  resolveOrderBy,
} from '../fetchEvents';
import { EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE } from '../planGating';

jest.mock('../../graphql/queries/ObserveQuery');

describe(resolveOrderBy, () => {
  it('maps "slowest" to METRIC_VALUE DESC', () => {
    expect(resolveOrderBy(EventsOrderPreset.Slowest)).toEqual({
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('maps "fastest" to METRIC_VALUE ASC', () => {
    expect(resolveOrderBy(EventsOrderPreset.Fastest)).toEqual({
      field: AppObserveEventsOrderByField.MetricValue,
      direction: AppObserveEventsOrderByDirection.Asc,
    });
  });

  it('maps "newest" to TIMESTAMP DESC', () => {
    expect(resolveOrderBy(EventsOrderPreset.Newest)).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('maps "oldest" to TIMESTAMP ASC', () => {
    expect(resolveOrderBy(EventsOrderPreset.Oldest)).toEqual({
      field: AppObserveEventsOrderByField.Timestamp,
      direction: AppObserveEventsOrderByDirection.Asc,
    });
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
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
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
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
    });
  });

  it('includes platform in filter when provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 5,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platform: AppObservePlatform.Ios,
    });

    expect(mockEventsAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      expect.objectContaining({
        filter: expect.objectContaining({
          platform: AppObservePlatform.Ios,
        }),
      })
    );
  });

  it('includes appVersion in filter when provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      appVersion: '1.2.0',
    });

    expect(mockEventsAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      expect.objectContaining({
        filter: expect.objectContaining({
          appVersion: '1.2.0',
        }),
      })
    );
  });

  it('includes appUpdateId in filter when updateId is provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      updateId: 'update-abc-123',
    });

    expect(mockEventsAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      expect.objectContaining({
        filter: expect.objectContaining({
          appUpdateId: 'update-abc-123',
        }),
      })
    );
  });

  it('includes easClientId in filter when provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      easClientId: 'client-abc-123',
    });

    expect(mockEventsAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      expect.objectContaining({
        filter: expect.objectContaining({
          easClientId: 'client-abc-123',
        }),
      })
    );
  });

  it('omits platform, appVersion, appUpdateId, and easClientId from filter when not provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const calledFilter = mockEventsAsync.mock.calls[0][1].filter;
    expect(calledFilter).not.toHaveProperty('platform');
    expect(calledFilter).not.toHaveProperty('appVersion');
    expect(calledFilter).not.toHaveProperty('appUpdateId');
    expect(calledFilter).not.toHaveProperty('easClientId');
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
      pageInfo: {
        hasNextPage: true,
        hasPreviousPage: false,
        endCursor: 'cursor-1',
      },
    });

    const result = await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].metricValue).toBe(1.23);
    expect(result.pageInfo.hasNextPage).toBe(true);
  });

  it('passes after cursor to ObserveQuery.eventsAsync', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 10,
      after: 'cursor-abc',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    expect(mockEventsAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      expect.objectContaining({ first: 10, after: 'cursor-abc' })
    );
  });

  it('omits after when not provided', async () => {
    mockEventsAsync.mockResolvedValue({
      events: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });

    await fetchObserveEventsAsync(mockGraphqlClient, 'app-123', {
      metricName: 'expo.app_startup.tti',
      orderBy: {
        field: AppObserveEventsOrderByField.MetricValue,
        direction: AppObserveEventsOrderByDirection.Desc,
      },
      limit: 10,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
    });

    const calledVars = mockEventsAsync.mock.calls[0][1];
    expect(calledVars).not.toHaveProperty('after');
  });
});

describe(fetchTotalEventCountAsync, () => {
  const mockAppVersionsAsync = jest.mocked(ObserveQuery.appVersionsAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockAppVersionsAsync.mockReset();
  });

  it('rethrows plan-gate errors instead of swallowing them as zero', async () => {
    const gateError = new CombinedError({
      graphQLErrors: [
        new GraphQLError(
          'Subscription to EAS is required for this feature.',
          null,
          null,
          null,
          null,
          null,
          {
            errorCode: EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE,
          }
        ),
      ],
    });
    mockAppVersionsAsync.mockRejectedValue(gateError);

    await expect(
      fetchTotalEventCountAsync(
        mockGraphqlClient,
        'project-123',
        'expo.navigation.tti',
        [AppPlatform.Ios, AppPlatform.Android],
        '2025-01-01T00:00:00.000Z',
        '2025-03-01T00:00:00.000Z'
      )
    ).rejects.toBe(gateError);
  });

  it('swallows non-gate errors and counts them as zero', async () => {
    mockAppVersionsAsync.mockRejectedValue(new Error('Network error'));

    const total = await fetchTotalEventCountAsync(
      mockGraphqlClient,
      'project-123',
      'expo.app_startup.tti',
      [AppPlatform.Ios],
      '2025-01-01T00:00:00.000Z',
      '2025-03-01T00:00:00.000Z'
    );

    expect(total).toBe(0);
  });
});
