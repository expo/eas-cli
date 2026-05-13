import { AppPlatform } from '../../graphql/generated';
import { NavigationRouteWithPlatform } from '../fetchNavigationRoutes';
import {
  buildObserveNavigationRoutesJson,
  buildObserveNavigationRoutesTable,
  isNavigationMetric,
  resolveNavigationStatKey,
} from '../formatNavigationRoutes';

function makeRoute(
  routeName: string,
  platform: AppPlatform,
  overrides?: Partial<{
    coldTtr: { count: number; median: number | null; p90: number | null };
    warmTtr: { count: number; median: number | null; p90: number | null };
    tti: { count: number; median: number | null; p90: number | null };
  }>
): NavigationRouteWithPlatform {
  return {
    platform,
    route: {
      __typename: 'AppObserveNavigationRoute' as const,
      routeName,
      coldTtr: {
        __typename: 'AppObserveNavigationStat' as const,
        count: 10,
        median: 0.5,
        p90: 0.9,
        ...overrides?.coldTtr,
      },
      warmTtr: {
        __typename: 'AppObserveNavigationStat' as const,
        count: 8,
        median: 0.3,
        p90: 0.6,
        ...overrides?.warmTtr,
      },
      tti: {
        __typename: 'AppObserveNavigationStat' as const,
        count: 12,
        median: 0.45,
        p90: 0.7,
        ...overrides?.tti,
      },
    },
  };
}

describe(isNavigationMetric, () => {
  it('returns true for each known navigation metric full name', () => {
    expect(isNavigationMetric('expo.navigation.cold_ttr')).toBe(true);
    expect(isNavigationMetric('expo.navigation.warm_ttr')).toBe(true);
    expect(isNavigationMetric('expo.navigation.tti')).toBe(true);
  });

  it('returns false for app-startup metrics or unknown names', () => {
    expect(isNavigationMetric('expo.app_startup.tti')).toBe(false);
    expect(isNavigationMetric('cold_ttr')).toBe(false);
    expect(isNavigationMetric('unknown')).toBe(false);
  });
});

describe(resolveNavigationStatKey, () => {
  it('resolves aliases', () => {
    expect(resolveNavigationStatKey('med')).toBe('median');
    expect(resolveNavigationStatKey('median')).toBe('median');
    expect(resolveNavigationStatKey('p90')).toBe('p90');
    expect(resolveNavigationStatKey('count')).toBe('count');
    expect(resolveNavigationStatKey('eventCount')).toBe('count');
    expect(resolveNavigationStatKey('event_count')).toBe('count');
  });

  it('throws on unknown stat', () => {
    expect(() => resolveNavigationStatKey('min')).toThrow('Unknown statistic');
  });
});

describe(buildObserveNavigationRoutesTable, () => {
  it('returns a yellow warning when no routes are present', () => {
    const output = buildObserveNavigationRoutesTable(
      [],
      ['expo.navigation.cold_ttr'],
      ['median', 'count']
    );
    expect(output).toContain('No navigation routes found.');
  });

  it('formats routes grouped by platform with merged (med + count) cells', () => {
    const routes = [
      makeRoute('/home', AppPlatform.Ios),
      makeRoute('/profile', AppPlatform.Ios, {
        coldTtr: { count: 5, median: 0.7, p90: 1.0 },
      }),
      makeRoute('/home', AppPlatform.Android),
    ];

    const output = buildObserveNavigationRoutesTable(
      routes,
      ['expo.navigation.cold_ttr', 'expo.navigation.warm_ttr', 'expo.navigation.tti'],
      ['median', 'count'],
      { daysBack: 7 }
    );

    expect(output).toContain('Med values (navigation count) for the last 7 days');
    expect(output).toContain('Cold TTR');
    expect(output).toContain('Warm TTR');
    expect(output).toContain('Nav TTI');
    expect(output).toContain('/home');
    expect(output).toContain('/profile');
    expect(output).toContain('0.50s (10)');
    expect(output).toContain('0.70s (5)');
    expect(output).toContain('iOS');
    expect(output).toContain('Android');
  });

  it('renders separate columns when count is omitted from stats', () => {
    const routes = [makeRoute('/home', AppPlatform.Ios)];
    const output = buildObserveNavigationRoutesTable(
      routes,
      ['expo.navigation.cold_ttr'],
      ['median', 'p90']
    );

    expect(output).toContain('Med, P90 values');
    expect(output).toContain('Cold TTR Med');
    expect(output).toContain('Cold TTR P90');
    expect(output).toContain('0.50s');
    expect(output).toContain('0.90s');
  });

  it('renders count-only column when only count stat is requested', () => {
    const routes = [makeRoute('/home', AppPlatform.Ios)];
    const output = buildObserveNavigationRoutesTable(
      routes,
      ['expo.navigation.cold_ttr'],
      ['count']
    );

    expect(output).toContain('Navigation count values');
    expect(output).toContain('Cold TTR Count');
    expect(output).toContain('10');
  });

  it('shows a next-page hint per platform when hasNextPage is true', () => {
    const routes = [makeRoute('/home', AppPlatform.Ios)];
    const pageInfoByPlatform = new Map([
      [AppPlatform.Ios, { hasNextPage: true, endCursor: 'cursor-ios' }],
    ]);

    const output = buildObserveNavigationRoutesTable(
      routes,
      ['expo.navigation.cold_ttr'],
      ['median', 'count'],
      { pageInfoByPlatform }
    );

    expect(output).toContain('Next page (iOS): --after cursor-ios');
  });
});

describe(buildObserveNavigationRoutesJson, () => {
  it('maps routes to the requested metrics and stats, including pageInfoByPlatform', () => {
    const routes = [makeRoute('/home', AppPlatform.Ios)];
    const pageInfoByPlatform = new Map([
      [AppPlatform.Ios, { hasNextPage: true, endCursor: 'cursor-ios' }],
    ]);

    const result = buildObserveNavigationRoutesJson(
      routes,
      ['expo.navigation.cold_ttr', 'expo.navigation.tti'],
      ['median', 'p90', 'count'],
      pageInfoByPlatform
    );

    expect(result.routes).toEqual([
      {
        routeName: '/home',
        platform: AppPlatform.Ios,
        metrics: {
          'expo.navigation.cold_ttr': { median: 0.5, p90: 0.9, count: 10 },
          'expo.navigation.tti': { median: 0.45, p90: 0.7, count: 12 },
        },
      },
    ]);
    expect(result.pageInfoByPlatform).toEqual({
      [AppPlatform.Ios]: { hasNextPage: true, endCursor: 'cursor-ios' },
    });
  });

  it('returns null for stats when the underlying value is null', () => {
    const routes = [
      makeRoute('/home', AppPlatform.Ios, {
        coldTtr: { count: 0, median: null, p90: null },
      }),
    ];

    const result = buildObserveNavigationRoutesJson(
      routes,
      ['expo.navigation.cold_ttr'],
      ['median', 'p90', 'count'],
      new Map()
    );

    expect(result.routes[0].metrics['expo.navigation.cold_ttr']).toEqual({
      median: null,
      p90: null,
      count: 0,
    });
  });
});
