import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import {
  AppObserveEventsOrderByDirection,
  AppObserveNavigationRoute,
  AppObserveNavigationRoutesOrderByField,
  AppObservePlatform,
  AppPlatform,
} from '../../graphql/generated';
import { ObserveQuery } from '../../graphql/queries/ObserveQuery';
import { fetchObserveNavigationRoutesAsync } from '../fetchNavigationRoutes';
import { EAS_OBSERVE_FEATURE_NOT_AVAILABLE_IN_FREE_TIER_ERROR_CODE } from '../planGating';

jest.mock('../../graphql/queries/ObserveQuery');
jest.mock('../../log');

function makeRoute(routeName: string): AppObserveNavigationRoute {
  return {
    __typename: 'AppObserveNavigationRoute' as const,
    routeName,
    coldTtr: { __typename: 'AppObserveNavigationStat' as const, count: 10, median: 0.5, p90: 0.9 },
    warmTtr: { __typename: 'AppObserveNavigationStat' as const, count: 8, median: 0.3, p90: 0.6 },
    tti: { __typename: 'AppObserveNavigationStat' as const, count: 12, median: 0.45, p90: 0.7 },
  };
}

describe('fetchObserveNavigationRoutesAsync', () => {
  const mockNavigationRoutesAsync = jest.mocked(ObserveQuery.navigationRoutesAsync);
  const mockGraphqlClient = {} as any;

  beforeEach(() => {
    mockNavigationRoutesAsync.mockClear();
    mockNavigationRoutesAsync.mockResolvedValue({
      routes: [],
      pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
  });

  it('passes appId, time range, limit, and filter values for each platform', async () => {
    await fetchObserveNavigationRoutesAsync(mockGraphqlClient, 'project-123', {
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppPlatform.Ios],
      limit: 25,
      appVersion: '2.1.0',
      updateId: 'update-xyz',
      buildNumber: '42',
    });

    expect(mockNavigationRoutesAsync).toHaveBeenCalledTimes(1);
    const call = mockNavigationRoutesAsync.mock.calls[0][1];
    expect(call.appId).toBe('project-123');
    expect(call.first).toBe(25);
    expect(call.filter).toEqual({
      platform: AppObservePlatform.Ios,
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      appVersion: '2.1.0',
      appUpdateId: 'update-xyz',
      appBuildNumber: '42',
    });
  });

  it('defaults orderBy to NAVIGATION_COUNT DESC', async () => {
    await fetchObserveNavigationRoutesAsync(mockGraphqlClient, 'project-123', {
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppPlatform.Ios],
      limit: 50,
    });

    const call = mockNavigationRoutesAsync.mock.calls[0][1];
    expect(call.orderBy).toEqual({
      field: AppObserveNavigationRoutesOrderByField.NavigationCount,
      direction: AppObserveEventsOrderByDirection.Desc,
    });
  });

  it('does not send optional filters when not provided', async () => {
    await fetchObserveNavigationRoutesAsync(mockGraphqlClient, 'project-123', {
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppPlatform.Ios],
      limit: 50,
    });

    const filter = mockNavigationRoutesAsync.mock.calls[0][1].filter;
    expect(filter).not.toHaveProperty('appVersion');
    expect(filter).not.toHaveProperty('appUpdateId');
    expect(filter).not.toHaveProperty('appBuildNumber');
    expect(filter).not.toHaveProperty('routeNames');
  });

  it('forwards routeNames filter when provided', async () => {
    await fetchObserveNavigationRoutesAsync(mockGraphqlClient, 'project-123', {
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppPlatform.Ios],
      limit: 50,
      routeNames: ['/home', '/profile'],
    });

    expect(mockNavigationRoutesAsync.mock.calls[0][1].filter.routeNames).toEqual([
      '/home',
      '/profile',
    ]);
  });

  it('does not send routeNames when array is empty', async () => {
    await fetchObserveNavigationRoutesAsync(mockGraphqlClient, 'project-123', {
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppPlatform.Ios],
      limit: 50,
      routeNames: [],
    });

    expect(mockNavigationRoutesAsync.mock.calls[0][1].filter).not.toHaveProperty('routeNames');
  });

  it('forwards after cursor when provided', async () => {
    await fetchObserveNavigationRoutesAsync(mockGraphqlClient, 'project-123', {
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-03-01T00:00:00.000Z',
      platforms: [AppPlatform.Ios],
      limit: 50,
      after: 'cursor-abc',
    });

    expect(mockNavigationRoutesAsync.mock.calls[0][1].after).toBe('cursor-abc');
  });

  it('fans out across multiple platforms and tags each route with its platform', async () => {
    mockNavigationRoutesAsync.mockImplementation(async (_client, vars) => {
      if (vars.filter.platform === AppObservePlatform.Android) {
        return {
          routes: [makeRoute('/android-home')],
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
        };
      }
      return {
        routes: [makeRoute('/ios-home')],
        pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'ios-cursor' },
      };
    });

    const { routes, pageInfoByPlatform } = await fetchObserveNavigationRoutesAsync(
      mockGraphqlClient,
      'project-123',
      {
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-03-01T00:00:00.000Z',
        platforms: [AppPlatform.Ios, AppPlatform.Android],
        limit: 50,
      }
    );

    expect(mockNavigationRoutesAsync).toHaveBeenCalledTimes(2);
    expect(routes).toHaveLength(2);
    const byName = new Map(routes.map(r => [r.route.routeName, r.platform]));
    expect(byName.get('/android-home')).toBe(AppPlatform.Android);
    expect(byName.get('/ios-home')).toBe(AppPlatform.Ios);
    expect(pageInfoByPlatform.get(AppPlatform.Ios)?.hasNextPage).toBe(true);
    expect(pageInfoByPlatform.get(AppPlatform.Android)?.hasNextPage).toBe(false);
  });

  it('handles partial failures gracefully', async () => {
    mockNavigationRoutesAsync.mockImplementation(async (_client, vars) => {
      if (vars.filter.platform === AppObservePlatform.Android) {
        throw new Error('Network error');
      }
      return {
        routes: [makeRoute('/home')],
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
      };
    });

    const { routes, pageInfoByPlatform } = await fetchObserveNavigationRoutesAsync(
      mockGraphqlClient,
      'project-123',
      {
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-03-01T00:00:00.000Z',
        platforms: [AppPlatform.Ios, AppPlatform.Android],
        limit: 50,
      }
    );

    expect(routes).toHaveLength(1);
    expect(routes[0].platform).toBe(AppPlatform.Ios);
    expect(pageInfoByPlatform.has(AppPlatform.Android)).toBe(false);
  });

  it('rethrows plan-gate errors instead of swallowing them as a partial failure', async () => {
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
    mockNavigationRoutesAsync.mockRejectedValue(gateError);

    await expect(
      fetchObserveNavigationRoutesAsync(mockGraphqlClient, 'project-123', {
        startTime: '2025-01-01T00:00:00.000Z',
        endTime: '2025-03-01T00:00:00.000Z',
        platforms: [AppPlatform.Ios, AppPlatform.Android],
        limit: 50,
      })
    ).rejects.toBe(gateError);
  });
});
