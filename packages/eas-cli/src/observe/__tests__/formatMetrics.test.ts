import { AppPlatform, BuildPriority, BuildStatus } from '../../graphql/generated';
import {
  DEFAULT_STATS_JSON,
  DEFAULT_STATS_TABLE,
  ObserveMetricsMap,
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  makeMetricsKey,
  resolveStatKey,
  type MetricValues,
} from '../formatMetrics';

function createMockBuild(overrides: {
  id: string;
  platform: AppPlatform;
  appVersion: string | null;
  buildProfile?: string | null;
  completedAt?: string | null;
  gitCommitHash?: string | null;
}): ReturnType<typeof createBuildFragment> {
  return createBuildFragment(overrides);
}

function createBuildFragment(overrides: {
  id: string;
  platform: AppPlatform;
  appVersion: string | null;
  buildProfile?: string | null;
  completedAt?: string | null;
  gitCommitHash?: string | null;
}) {
  return {
    __typename: 'Build' as const,
    id: overrides.id,
    status: BuildStatus.Finished,
    platform: overrides.platform,
    appVersion: overrides.appVersion,
    appBuildVersion: '1',
    buildProfile: overrides.buildProfile ?? 'production',
    completedAt: overrides.completedAt ?? '2025-01-15T10:00:00.000Z',
    createdAt: '2025-01-15T09:00:00.000Z',
    updatedAt: '2025-01-15T10:00:00.000Z',
    channel: 'production',
    distribution: null,
    iosEnterpriseProvisioning: null,
    sdkVersion: '52.0.0',
    runtimeVersion: '1.0.0',
    gitCommitHash: overrides.gitCommitHash ?? 'abc1234567890',
    gitCommitMessage: 'test commit',
    initialQueuePosition: null,
    queuePosition: null,
    estimatedWaitTimeLeftSeconds: null,
    priority: BuildPriority.Normal,
    message: null,
    expirationDate: null,
    isForIosSimulator: false,
    error: null,
    artifacts: null,
    fingerprint: null,
    initiatingActor: null,
    logFiles: [],
    project: {
      __typename: 'App' as const,
      id: 'project-id',
      name: 'test-app',
      slug: 'test-app',
      ownerAccount: { id: 'account-id', name: 'test-owner' },
    },
    metrics: null,
  };
}

const DEFAULT_METRICS = ['expo.app_startup.cold_launch_time', 'expo.app_startup.tti'];

function makeMetricValueWithDefaults(overrides: Partial<MetricValues>): MetricValues {
  return {
    min: 0.1,
    median: 0.3,
    max: 1.1,
    average: 0.5,
    p80: 0.8,
    p90: 0.9,
    p99: 1.0,
    eventCount: 100,
    ...overrides,
  };
}

describe(buildObserveMetricsTable, () => {
  it('formats builds grouped by version with min, median, max columns', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: '1.2.0',
        gitCommitHash: 'aaa1111222233334444',
      }),
      createMockBuild({
        id: 'build-2',
        platform: AppPlatform.Ios,
        appVersion: '1.2.0',
        gitCommitHash: 'bbb2222333344445555',
      }),
      createMockBuild({
        id: 'build-3',
        platform: AppPlatform.Android,
        appVersion: '1.1.0',
        gitCommitHash: 'ccc3333444455556666',
      }),
    ];

    const metricsMap: ObserveMetricsMap = new Map();
    const iosKey = makeMetricsKey('1.2.0', AppPlatform.Ios);
    metricsMap.set(
      iosKey,
      new Map([
        [
          'expo.app_startup.cold_launch_time',
          makeMetricValueWithDefaults({ median: 0.35, eventCount: 110 }),
        ],
        ['expo.app_startup.tti', makeMetricValueWithDefaults({ median: 1.32123, eventCount: 90 })],
      ])
    );

    const androidKey = makeMetricsKey('1.1.0', AppPlatform.Android);
    metricsMap.set(
      androidKey,
      new Map([
        [
          'expo.app_startup.cold_launch_time',
          makeMetricValueWithDefaults({ median: 0.25, eventCount: 120 }),
        ],
        ['expo.app_startup.tti', makeMetricValueWithDefaults({ median: 1.12111, eventCount: 100 })],
      ])
    );

    const output = buildObserveMetricsTable(
      builds,
      metricsMap,
      DEFAULT_METRICS,
      DEFAULT_STATS_TABLE
    );

    // The header is bolded, thus the escape characters in the snapshot
    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits           Cold Launch Med  Cold Launch Count  TTI Med  TTI Count[22m
-----------  --------  ------------  ----------------  ---------------  -----------------  -------  ---------
1.2.0        iOS       Jan 15, 2025  aaa1111, bbb2222  0.35s            110                1.32s    90       
1.1.0        Android   Jan 15, 2025  ccc3333           0.25s            120                1.12s    100      "
`);
  });

  it('shows - for builds with no matching observe data', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: '2.0.0',
      }),
    ];

    const output = buildObserveMetricsTable(
      builds,
      new Map(),
      DEFAULT_METRICS,
      DEFAULT_STATS_TABLE
    );

    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits  Cold Launch Med  Cold Launch Count  TTI Med  TTI Count[22m
-----------  --------  ------------  -------  ---------------  -----------------  -------  ---------
2.0.0        iOS       Jan 15, 2025  abc1234  -                -                  -        -        "
`);
  });

  it('shows - for builds with null appVersion', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: null,
      }),
    ];

    const output = buildObserveMetricsTable(
      builds,
      new Map(),
      DEFAULT_METRICS,
      DEFAULT_STATS_TABLE
    );

    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits  Cold Launch Med  Cold Launch Count  TTI Med  TTI Count[22m
-----------  --------  ------------  -------  ---------------  -----------------  -------  ---------
-            iOS       Jan 15, 2025  abc1234  -                -                  -        -        "
`);
  });

  it('returns message when no builds found', () => {
    const output = buildObserveMetricsTable([], new Map(), DEFAULT_METRICS, DEFAULT_STATS_TABLE);
    expect(output).toMatchInlineSnapshot(`"[33mNo finished builds found.[39m"`);
  });

  it('shows the latest build date when multiple builds share a version', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        completedAt: '2025-01-10T10:00:00.000Z',
        gitCommitHash: 'aaa1111222233334444',
      }),
      createMockBuild({
        id: 'build-2',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        completedAt: '2025-01-20T10:00:00.000Z',
        gitCommitHash: 'bbb2222333344445555',
      }),
    ];

    const output = buildObserveMetricsTable(
      builds,
      new Map(),
      DEFAULT_METRICS,
      DEFAULT_STATS_TABLE
    );

    expect(output).toContain('1.0.0');
    expect(output).toContain('iOS');
    expect(output).toContain('Jan 20, 2025');
    expect(output).not.toContain('Jan 10, 2025');
  });

  it('deduplicates commit hashes for same version+platform', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        gitCommitHash: 'same123456789',
      }),
      createMockBuild({
        id: 'build-2',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        gitCommitHash: 'same123456789',
      }),
    ];

    const output = buildObserveMetricsTable(
      builds,
      new Map(),
      DEFAULT_METRICS,
      DEFAULT_STATS_TABLE
    );

    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Last Build    Commits  Cold Launch Med  Cold Launch Count  TTI Med  TTI Count[22m
-----------  --------  ------------  -------  ---------------  -----------------  -------  ---------
1.0.0        iOS       Jan 15, 2025  same123  -                -                  -        -        "
`);
  });
});

describe(buildObserveMetricsJson, () => {
  it('produces grouped JSON with min, median, max per metric', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        gitCommitHash: 'aaa1111222233334444',
      }),
      createMockBuild({
        id: 'build-2',
        platform: AppPlatform.Ios,
        appVersion: '1.0.0',
        gitCommitHash: 'bbb2222333344445555',
      }),
    ];

    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([
        ['expo.app_startup.tti', makeMetricValueWithDefaults({ median: 0.12, eventCount: 90 })],
      ])
    );

    const result = buildObserveMetricsJson(
      builds,
      metricsMap,
      ['expo.app_startup.tti'],
      DEFAULT_STATS_JSON
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      appVersion: '1.0.0',
      platform: AppPlatform.Ios,
      lastBuildDate: '2025-01-15T10:00:00.000Z',
      commits: ['aaa1111', 'bbb2222'],
      metrics: {
        'expo.app_startup.tti': {
          min: 0.1,
          median: 0.12,
          max: 1.1,
          average: 0.5,
          p80: 0.8,
          p90: 0.9,
          p99: 1.0,
          eventCount: 90,
        },
      },
    });
  });

  it('produces null min/median/max when no observe data matches', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Android,
        appVersion: '3.0.0',
      }),
    ];

    const result = buildObserveMetricsJson(
      builds,
      new Map(),
      ['expo.app_startup.tti'],
      DEFAULT_STATS_JSON
    );

    expect(result[0].metrics).toEqual({
      'expo.app_startup.tti': {
        min: null,
        median: null,
        max: null,
        average: null,
        p80: null,
        p90: null,
        p99: null,
        eventCount: null,
      },
    });
  });

  it('produces null appVersion when build has no appVersion', () => {
    const builds = [
      createMockBuild({
        id: 'build-1',
        platform: AppPlatform.Ios,
        appVersion: null,
      }),
    ];

    const result = buildObserveMetricsJson(
      builds,
      new Map(),
      ['expo.app_startup.tti'],
      DEFAULT_STATS_JSON
    );

    expect(result[0].appVersion).toBeNull();
    expect(result[0].metrics['expo.app_startup.tti']).toEqual({
      min: null,
      median: null,
      max: null,
      average: null,
      p80: null,
      p90: null,
      p99: null,
      eventCount: null,
    });
  });
});

describe(makeMetricsKey, () => {
  it('creates a key from version and platform', () => {
    expect(makeMetricsKey('1.0.0', AppPlatform.Ios)).toBe('1.0.0:IOS');
    expect(makeMetricsKey('2.0.0', AppPlatform.Android)).toBe('2.0.0:ANDROID');
  });
});

describe(resolveStatKey, () => {
  it('resolves canonical stat names', () => {
    expect(resolveStatKey('min')).toBe('min');
    expect(resolveStatKey('max')).toBe('max');
    expect(resolveStatKey('median')).toBe('median');
    expect(resolveStatKey('average')).toBe('average');
    expect(resolveStatKey('p80')).toBe('p80');
    expect(resolveStatKey('p90')).toBe('p90');
    expect(resolveStatKey('p99')).toBe('p99');
    expect(resolveStatKey('eventCount')).toBe('eventCount');
  });

  it('resolves short aliases', () => {
    expect(resolveStatKey('med')).toBe('median');
    expect(resolveStatKey('avg')).toBe('average');
    expect(resolveStatKey('count')).toBe('eventCount');
    expect(resolveStatKey('event_count')).toBe('eventCount');
  });

  it('throws on unknown stat', () => {
    expect(() => resolveStatKey('unknown')).toThrow('Unknown statistic: "unknown"');
  });
});

describe('DEFAULT_STATS_TABLE', () => {
  it('defaults to median, eventCount', () => {
    expect(DEFAULT_STATS_TABLE).toEqual(['median', 'eventCount']);
  });
});

describe('DEFAULT_STATS_JSON', () => {
  it('includes all stats', () => {
    expect(DEFAULT_STATS_JSON).toEqual([
      'min',
      'median',
      'max',
      'average',
      'p80',
      'p90',
      'p99',
      'eventCount',
    ]);
  });
});

describe('custom stats parameter', () => {
  const builds = [
    createMockBuild({
      id: 'build-1',
      platform: AppPlatform.Ios,
      appVersion: '1.0.0',
      gitCommitHash: 'aaa1111222233334444',
    }),
  ];

  it('table renders only selected stats', () => {
    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([
        [
          'expo.app_startup.tti',
          {
            min: 0.01,
            median: 0.1,
            max: 0.5,
            average: null,
            p80: null,
            p90: null,
            p99: 0.9,
            eventCount: 42,
          },
        ],
      ])
    );

    const output = buildObserveMetricsTable(
      builds,
      metricsMap,
      ['expo.app_startup.tti'],
      ['p99', 'eventCount']
    );

    expect(output).toContain('TTI P99');
    expect(output).toContain('TTI Count');
    expect(output).toContain('0.90s');
    expect(output).toContain('42');
    expect(output).not.toContain('TTI Min');
    expect(output).not.toContain('TTI Med');
    expect(output).not.toContain('TTI Max');
  });

  it("table formats eventCount as integer without 's' suffix", () => {
    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([
        [
          'expo.app_startup.tti',
          {
            min: 0.01,
            median: 0.1,
            max: 0.5,
            average: null,
            p80: null,
            p90: null,
            p99: null,
            eventCount: 100,
          },
        ],
      ])
    );

    const output = buildObserveMetricsTable(
      builds,
      metricsMap,
      ['expo.app_startup.tti'],
      ['eventCount']
    );

    expect(output).toContain('100');
    expect(output).not.toContain('100s');
    expect(output).not.toContain('100.00s');
  });

  it('JSON includes only selected stats', () => {
    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([
        [
          'expo.app_startup.tti',
          {
            min: 0.01,
            median: 0.1,
            max: 0.5,
            average: 0.15,
            p80: 0.3,
            p90: 0.4,
            p99: 0.9,
            eventCount: 42,
          },
        ],
      ])
    );

    const result = buildObserveMetricsJson(
      builds,
      metricsMap,
      ['expo.app_startup.tti'],
      ['p90', 'eventCount']
    );

    expect(result[0].metrics['expo.app_startup.tti']).toEqual({
      p90: 0.4,
      eventCount: 42,
    });
  });

  it('JSON uses default stats when not specified', () => {
    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([
        [
          'expo.app_startup.tti',
          {
            min: 0.02,
            median: 0.1,
            max: 0.4,
            average: null,
            p80: null,
            p90: null,
            p99: null,
            eventCount: null,
          },
        ],
      ])
    );

    const result = buildObserveMetricsJson(
      builds,
      metricsMap,
      ['expo.app_startup.tti'],
      DEFAULT_STATS_JSON
    );

    expect(result[0].metrics['expo.app_startup.tti']).toEqual({
      min: 0.02,
      median: 0.1,
      max: 0.4,
      average: null,
      p80: null,
      p90: null,
      p99: null,
      eventCount: null,
    });
  });
});
