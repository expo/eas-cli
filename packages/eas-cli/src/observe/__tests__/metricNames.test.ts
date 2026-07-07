import {
  getMetricDisplayName,
  isKnownMetricName,
  resolveMetricName,
  resolveNavigationMetricName,
} from '../metricNames';

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

  it('resolves short alias "update_download" to full metric name', () => {
    expect(resolveMetricName('update_download')).toBe('expo.updates.download_time');
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

  it('resolves navigation short aliases so they can be passed on the observe:metrics command line', () => {
    expect(resolveMetricName('nav_cold_ttr')).toBe('expo.navigation.cold_ttr');
    expect(resolveMetricName('nav_warm_ttr')).toBe('expo.navigation.warm_ttr');
    expect(resolveMetricName('nav_tti')).toBe('expo.navigation.tti');
  });

  it('passes through navigation full metric names unchanged', () => {
    expect(resolveMetricName('expo.navigation.cold_ttr')).toBe('expo.navigation.cold_ttr');
    expect(resolveMetricName('expo.navigation.warm_ttr')).toBe('expo.navigation.warm_ttr');
    expect(resolveMetricName('expo.navigation.tti')).toBe('expo.navigation.tti');
  });

  it('lists both app-startup and navigation aliases in the error message on unknown alias', () => {
    try {
      resolveMetricName('bogus');
    } catch (e: any) {
      expect(e.message).toMatchSnapshot();
    }
  });
});

describe(resolveNavigationMetricName, () => {
  it('resolves short aliases to navigation metric full names', () => {
    expect(resolveNavigationMetricName('nav_cold_ttr')).toBe('expo.navigation.cold_ttr');
    expect(resolveNavigationMetricName('nav_warm_ttr')).toBe('expo.navigation.warm_ttr');
    expect(resolveNavigationMetricName('nav_tti')).toBe('expo.navigation.tti');
  });

  it('passes through full navigation metric names unchanged', () => {
    expect(resolveNavigationMetricName('expo.navigation.cold_ttr')).toBe(
      'expo.navigation.cold_ttr'
    );
    expect(resolveNavigationMetricName('expo.navigation.warm_ttr')).toBe(
      'expo.navigation.warm_ttr'
    );
    expect(resolveNavigationMetricName('expo.navigation.tti')).toBe('expo.navigation.tti');
  });

  it('throws on unknown alias or non-navigation metric', () => {
    expect(() => resolveNavigationMetricName('unknown')).toThrow('Unknown navigation metric');
    expect(() => resolveNavigationMetricName('expo.app_startup.tti')).toThrow(
      'Unknown navigation metric'
    );
  });
});

describe(getMetricDisplayName, () => {
  it('returns short display name for known app-startup metrics', () => {
    expect(getMetricDisplayName('expo.app_startup.cold_launch_time')).toBe('Cold Launch');
    expect(getMetricDisplayName('expo.app_startup.warm_launch_time')).toBe('Warm Launch');
    expect(getMetricDisplayName('expo.app_startup.tti')).toBe('Startup TTI');
    expect(getMetricDisplayName('expo.app_startup.ttr')).toBe('Startup TTR');
    expect(getMetricDisplayName('expo.app_startup.bundle_load_time')).toBe('Bundle Load');
    expect(getMetricDisplayName('expo.updates.download_time')).toBe('Update Download');
  });

  it('returns short display name for known navigation metrics', () => {
    expect(getMetricDisplayName('expo.navigation.cold_ttr')).toBe('Nav Cold TTR');
    expect(getMetricDisplayName('expo.navigation.warm_ttr')).toBe('Nav Warm TTR');
    expect(getMetricDisplayName('expo.navigation.tti')).toBe('Nav TTI');
  });

  it('returns the full metric name for unknown metrics', () => {
    expect(getMetricDisplayName('custom.metric.name')).toBe('custom.metric.name');
  });
});

describe(isKnownMetricName, () => {
  it('returns true for app-startup short aliases', () => {
    expect(isKnownMetricName('tti')).toBe(true);
    expect(isKnownMetricName('cold_launch')).toBe(true);
    expect(isKnownMetricName('bundle_load')).toBe(true);
  });

  it('returns true for navigation short aliases', () => {
    expect(isKnownMetricName('cold_ttr')).toBe(true);
    expect(isKnownMetricName('warm_ttr')).toBe(true);
    expect(isKnownMetricName('nav_tti')).toBe(true);
  });

  it('returns true for full metric names', () => {
    expect(isKnownMetricName('expo.app_startup.tti')).toBe(true);
    expect(isKnownMetricName('expo.navigation.cold_ttr')).toBe(true);
  });

  it('returns false for unknown names (including custom event names)', () => {
    expect(isKnownMetricName('login_pressed')).toBe(false);
    expect(isKnownMetricName('some_random_event')).toBe(false);
    expect(isKnownMetricName('')).toBe(false);
    // A dotted name that isn't in the known-full set is still not "known"
    // for picker purposes; the picker treats it as a log event.
    expect(isKnownMetricName('custom.metric.name')).toBe(false);
  });
});
