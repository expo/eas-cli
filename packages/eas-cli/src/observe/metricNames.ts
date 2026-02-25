import { EasCommandError } from '../commandUtils/errors';

export const METRIC_ALIASES: Record<string, string> = {
  tti: 'expo.app_startup.tti',
  ttr: 'expo.app_startup.ttr',
  cold_launch: 'expo.app_startup.cold_launch_time',
  warm_launch: 'expo.app_startup.warm_launch_time',
  bundle_load: 'expo.app_startup.bundle_load_time',
};

const KNOWN_FULL_NAMES = new Set(Object.values(METRIC_ALIASES));

export const METRIC_SHORT_NAMES: Record<string, string> = {
  'expo.app_startup.cold_launch_time': 'Cold Launch',
  'expo.app_startup.warm_launch_time': 'Warm Launch',
  'expo.app_startup.tti': 'TTI',
  'expo.app_startup.ttr': 'TTR',
  'expo.app_startup.bundle_load_time': 'Bundle Load',
};

export function resolveMetricName(input: string): string {
  if (METRIC_ALIASES[input]) {
    return METRIC_ALIASES[input];
  }
  if (KNOWN_FULL_NAMES.has(input) || input.includes('.')) {
    return input;
  }
  throw new EasCommandError(
    `Unknown metric: "${input}". Use a full metric name (e.g. expo.app_startup.tti) or a short alias: ${Object.keys(METRIC_ALIASES).join(', ')}`
  );
}

export function getMetricDisplayName(metricName: string): string {
  return METRIC_SHORT_NAMES[metricName] ?? metricName;
}
