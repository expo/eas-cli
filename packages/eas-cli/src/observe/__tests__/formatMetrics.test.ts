import { AppPlatform } from '../../graphql/generated';
import {
  buildObserveMetricsJson,
  buildObserveMetricsTable,
  resolveStatKey,
} from '../formatMetrics';
import type { MetricValues, ObserveMetricsMap } from '../metrics.types';
import { makeMetricsKey } from '../utils';

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
  it('formats metrics grouped by version with metric columns', () => {
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
      metricsMap,
      ['expo.app_startup.cold_launch_time', 'expo.app_startup.tti'],
      ['median', 'eventCount']
    );

    // The header is bolded, thus the escape characters in the snapshot
    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Cold Launch Med  Cold Launch Count  TTI Med  TTI Count[22m
-----------  --------  ---------------  -----------------  -------  ---------
1.2.0        iOS       0.35s            110                1.32s    90       
1.1.0        Android   0.25s            120                1.12s    100      "
`);
  });

  it('shows - for metrics with missing values for versions', () => {
    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('2.0.0', AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([
        [
          'expo.app_startup.cold_launch_time',
          makeMetricValueWithDefaults({ median: 0.25, eventCount: 80 }),
        ],
      ])
    );

    const output = buildObserveMetricsTable(
      metricsMap,
      ['expo.app_startup.cold_launch_time', 'expo.app_startup.tti'],
      ['median', 'eventCount']
    );

    expect(output).toMatchInlineSnapshot(`
"[1mApp Version  Platform  Cold Launch Med  Cold Launch Count  TTI Med  TTI Count[22m
-----------  --------  ---------------  -----------------  -------  ---------
2.0.0        iOS       0.25s            80                 -        -        "
`);
  });

  it('returns message when no metrics data found', () => {
    const output = buildObserveMetricsTable(
      new Map(),
      ['expo.app_startup.cold_launch_time', 'expo.app_startup.tti'],
      ['median', 'eventCount']
    );
    expect(output).toMatchInlineSnapshot(`"[33mNo metrics data found.[39m"`);
  });
});

describe(buildObserveMetricsJson, () => {
  it('produces JSON with all stats per metric', () => {
    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('1.0.0', AppPlatform.Ios);
    metricsMap.set(
      key,
      new Map([
        ['expo.app_startup.tti', makeMetricValueWithDefaults({ median: 0.12, eventCount: 90 })],
      ])
    );

    const result = buildObserveMetricsJson(
      metricsMap,
      ['expo.app_startup.tti'],
      ['min', 'median', 'max', 'p99']
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      appVersion: '1.0.0',
      platform: AppPlatform.Ios,
      metrics: {
        'expo.app_startup.tti': {
          min: 0.1,
          median: 0.12,
          max: 1.1,
          p99: 1.0,
        },
      },
    });
  });

  it('produces null values for metrics missing from a version that has other metric data', () => {
    const metricsMap: ObserveMetricsMap = new Map();
    const key = makeMetricsKey('3.0.0', AppPlatform.Android);
    metricsMap.set(
      key,
      new Map([
        [
          'expo.app_startup.cold_launch_time',
          makeMetricValueWithDefaults({ median: 0.25, eventCount: 80 }),
        ],
      ])
    );

    const result = buildObserveMetricsJson(
      metricsMap,
      ['expo.app_startup.cold_launch_time', 'expo.app_startup.tti'],
      ['median', 'eventCount']
    );

    expect(result[0].metrics).toEqual({
      'expo.app_startup.cold_launch_time': {
        median: 0.25,
        eventCount: 80,
      },
      'expo.app_startup.tti': {
        median: null,
        eventCount: null,
      },
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

describe('custom stats parameter', () => {
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

    const output = buildObserveMetricsTable(metricsMap, ['expo.app_startup.tti'], ['eventCount']);

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
      metricsMap,
      ['expo.app_startup.tti'],
      ['p90', 'eventCount']
    );

    expect(result[0].metrics['expo.app_startup.tti']).toEqual({
      p90: 0.4,
      eventCount: 42,
    });
  });
});
