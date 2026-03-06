import { getMetricDisplayName, resolveMetricName } from '../metricNames';

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
    expect(resolveMetricName('expo.app_startup.cold_launch_time')).toBe(
      'expo.app_startup.cold_launch_time'
    );
  });

  it('throws on unknown alias', () => {
    expect(() => resolveMetricName('unknown_metric')).toThrow('Unknown metric: "unknown_metric"');
  });

  it('passes through dot-containing custom metric names', () => {
    expect(resolveMetricName('custom.metric.name')).toBe('custom.metric.name');
  });
});

describe(getMetricDisplayName, () => {
  it('returns short display name for known metrics', () => {
    expect(getMetricDisplayName('expo.app_startup.cold_launch_time')).toBe('Cold Launch');
    expect(getMetricDisplayName('expo.app_startup.warm_launch_time')).toBe('Warm Launch');
    expect(getMetricDisplayName('expo.app_startup.tti')).toBe('TTI');
    expect(getMetricDisplayName('expo.app_startup.ttr')).toBe('TTR');
    expect(getMetricDisplayName('expo.app_startup.bundle_load_time')).toBe('Bundle Load');
  });

  it('returns the full metric name for unknown metrics', () => {
    expect(getMetricDisplayName('custom.metric.name')).toBe('custom.metric.name');
  });
});
