import { EasCommandError } from '../commandUtils/errors';

export const METRIC_ALIASES: Record<string, string> = {
  tti: 'expo.app_startup.tti',
  ttr: 'expo.app_startup.ttr',
  cold_launch: 'expo.app_startup.cold_launch_time',
  warm_launch: 'expo.app_startup.warm_launch_time',
  bundle_load: 'expo.app_startup.bundle_load_time',
  update_download: 'expo.updates.download_time',
};

export const NAVIGATION_METRIC_ALIASES: Record<string, string> = {
  nav_cold_ttr: 'expo.navigation.cold_ttr',
  nav_warm_ttr: 'expo.navigation.warm_ttr',
  nav_tti: 'expo.navigation.tti',
};

const KNOWN_FULL_NAMES = new Set(Object.values(METRIC_ALIASES));
const KNOWN_FULL_NAVIGATION_NAMES = new Set(Object.values(NAVIGATION_METRIC_ALIASES));

export const METRIC_SHORT_NAMES: Record<string, string> = {
  'expo.app_startup.cold_launch_time': 'Cold Launch',
  'expo.app_startup.warm_launch_time': 'Warm Launch',
  'expo.app_startup.tti': 'Startup TTI',
  'expo.app_startup.ttr': 'Startup TTR',
  'expo.app_startup.bundle_load_time': 'Bundle Load',
  'expo.updates.download_time': 'Update Download',
  'expo.navigation.cold_ttr': 'Nav Cold TTR',
  'expo.navigation.warm_ttr': 'Nav Warm TTR',
  'expo.navigation.tti': 'Nav TTI',
};

export function resolveMetricName(input: string): string {
  if (METRIC_ALIASES[input]) {
    return METRIC_ALIASES[input];
  }
  if (NAVIGATION_METRIC_ALIASES[input]) {
    return NAVIGATION_METRIC_ALIASES[input];
  }
  if (
    KNOWN_FULL_NAMES.has(input) ||
    KNOWN_FULL_NAVIGATION_NAMES.has(input) ||
    input.includes('.')
  ) {
    return input;
  }
  throw new EasCommandError(
    `Unknown metric: "${input}". Use a full metric name (e.g. expo.app_startup.tti) or a short alias: ${[
      ...Object.keys(METRIC_ALIASES),
      ...Object.keys(NAVIGATION_METRIC_ALIASES),
    ].join(', ')}`
  );
}

export function resolveNavigationMetricName(input: string): string {
  if (NAVIGATION_METRIC_ALIASES[input]) {
    return NAVIGATION_METRIC_ALIASES[input];
  }
  if (KNOWN_FULL_NAVIGATION_NAMES.has(input)) {
    return input;
  }
  throw new EasCommandError(
    `Unknown navigation metric: "${input}". Use a full metric name (e.g. expo.navigation.cold_ttr) or a short alias: ${Object.keys(
      NAVIGATION_METRIC_ALIASES
    ).join(', ')}`
  );
}

export function getMetricDisplayName(metricName: string): string {
  return METRIC_SHORT_NAMES[metricName] ?? metricName;
}
