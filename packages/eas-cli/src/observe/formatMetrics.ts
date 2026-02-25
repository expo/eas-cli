import chalk from 'chalk';

import { EasCommandError } from '../commandUtils/errors';
import { AppPlatform } from '../graphql/generated';
import { appPlatformDisplayNames } from '../platform';
import { getMetricDisplayName } from './metricNames';

export type StatisticKey =
  | 'min'
  | 'max'
  | 'median'
  | 'average'
  | 'p80'
  | 'p90'
  | 'p99'
  | 'eventCount';

export const STAT_ALIASES: Record<string, StatisticKey> = {
  min: 'min',
  max: 'max',
  med: 'median',
  median: 'median',
  avg: 'average',
  average: 'average',
  p80: 'p80',
  p90: 'p90',
  p99: 'p99',
  count: 'eventCount',
  event_count: 'eventCount',
  eventCount: 'eventCount',
};

export const STAT_DISPLAY_NAMES: Record<StatisticKey, string> = {
  min: 'Min',
  max: 'Max',
  median: 'Med',
  average: 'Avg',
  p80: 'P80',
  p90: 'P90',
  p99: 'P99',
  eventCount: 'Count',
};

/**
 * Resolves a user-provided stat alias (e.g. "avg", "med", "count") to graphql supported StatisticKey.
 */
export function resolveStatKey(input: string): StatisticKey {
  const resolved = STAT_ALIASES[input];
  if (resolved) {
    return resolved;
  }
  throw new EasCommandError(
    `Unknown statistic: "${input}". Valid options: ${Object.keys(STAT_ALIASES).join(', ')}`
  );
}

function formatStatValue(stat: StatisticKey, value: number | null | undefined): string {
  if (value == null) {
    return '-';
  }
  if (stat === 'eventCount') {
    return String(value);
  }
  return `${value.toFixed(2)}s`;
}

export interface MetricValues {
  min: number | null | undefined;
  max: number | null | undefined;
  median: number | null | undefined;
  average: number | null | undefined;
  p80: number | null | undefined;
  p90: number | null | undefined;
  p99: number | null | undefined;
  eventCount: number | null | undefined;
}

type ObserveMetricsKey = `${string}:${AppPlatform}`;

export type ObserveMetricsMap = Map<ObserveMetricsKey, Map<string, MetricValues>>;

export function makeMetricsKey(appVersion: string, platform: AppPlatform): ObserveMetricsKey {
  return `${appVersion}:${platform}`;
}

function parseMetricsKey(key: ObserveMetricsKey): { appVersion: string; platform: AppPlatform } {
  const lastColon = key.lastIndexOf(':');
  return {
    appVersion: key.slice(0, lastColon),
    platform: key.slice(lastColon + 1) as AppPlatform,
  };
}

export type MetricValuesJson = Partial<Record<StatisticKey, number | null>>;

export interface ObserveMetricsVersionResult {
  appVersion: string;
  platform: AppPlatform;
  metrics: Record<string, MetricValuesJson>;
}

export function buildObserveMetricsJson(
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
  stats: StatisticKey[]
): ObserveMetricsVersionResult[] {
  const results: ObserveMetricsVersionResult[] = [];

  for (const [key, versionMetrics] of metricsMap) {
    const { appVersion, platform } = parseMetricsKey(key);

    const metrics: Record<string, MetricValuesJson> = {};
    for (const metricName of metricNames) {
      const values = versionMetrics.get(metricName);
      const statValues: MetricValuesJson = {};
      for (const stat of stats) {
        statValues[stat] = values?.[stat] ?? null;
      }
      metrics[metricName] = statValues;
    }

    results.push({ appVersion, platform, metrics });
  }

  return results;
}

export function buildObserveMetricsTable(
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
  stats: StatisticKey[]
): string {
  const results = buildObserveMetricsJson(metricsMap, metricNames, stats);

  if (results.length === 0) {
    return chalk.yellow('No metrics data found.');
  }

  const fixedHeaders = ['App Version', 'Platform'];
  const metricHeaders: string[] = [];
  for (const m of metricNames) {
    const name = getMetricDisplayName(m);
    for (const stat of stats) {
      metricHeaders.push(`${name} ${STAT_DISPLAY_NAMES[stat]}`);
    }
  }
  const headers = [...fixedHeaders, ...metricHeaders];

  const rows: string[][] = results.map(result => {
    const metricCells: string[] = [];
    for (const m of metricNames) {
      const values = result.metrics[m];
      for (const stat of stats) {
        metricCells.push(formatStatValue(stat, values?.[stat] ?? null));
      }
    }

    return [result.appVersion, appPlatformDisplayNames[result.platform], ...metricCells];
  });

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  const separatorLine = colWidths.map(w => '-'.repeat(w)).join('  ');
  const dataLines = rows.map(row => row.map((cell, i) => cell.padEnd(colWidths[i])).join('  '));

  return [chalk.bold(headerLine), separatorLine, ...dataLines].join('\n');
}
