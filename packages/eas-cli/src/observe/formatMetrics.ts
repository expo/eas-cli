import chalk from 'chalk';

import { EasCommandError } from '../commandUtils/errors';
import { AppPlatform } from '../graphql/generated';
import { appPlatformDisplayNames } from '../platform';
import renderTextTable from '../utils/renderTextTable';
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

function formatMergedCell(
  stat: StatisticKey,
  statValue: number | null | undefined,
  eventCount: number | null | undefined
): string {
  const formatted = formatStatValue(stat, statValue);
  const count = eventCount != null ? String(eventCount) : '-';
  return `${formatted} (${count})`;
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
export type BuildNumbersMap = Map<ObserveMetricsKey, string[]>;
export type UpdateIdsMap = Map<ObserveMetricsKey, string[]>;

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
  buildNumbers: string[];
  updateIds: string[];
  metrics: Record<string, MetricValuesJson>;
}

export interface ObserveMetricsJsonOutput {
  versions: ObserveMetricsVersionResult[];
  totalEventCounts: Record<string, Record<string, number>>;
}

export function buildObserveMetricsJson(
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
  stats: StatisticKey[],
  totalEventCounts?: Map<string, number>,
  buildNumbersMap?: BuildNumbersMap,
  updateIdsMap?: UpdateIdsMap
): ObserveMetricsJsonOutput {
  const versions: ObserveMetricsVersionResult[] = [];

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

    versions.push({
      appVersion,
      platform,
      buildNumbers: buildNumbersMap?.get(key) ?? [],
      updateIds: updateIdsMap?.get(key) ?? [],
      metrics,
    });
  }

  // Group total event counts by metric → platform
  const counts: Record<string, Record<string, number>> = {};
  if (totalEventCounts) {
    for (const [key, count] of totalEventCounts) {
      const lastColon = key.lastIndexOf(':');
      const metricName = key.slice(0, lastColon);
      const platform = key.slice(lastColon + 1);
      if (!counts[metricName]) {
        counts[metricName] = {};
      }
      counts[metricName][platform] = count;
    }
  }

  return { versions, totalEventCounts: counts };
}

function buildStatsDescription(displayStats: StatisticKey[]): string {
  return displayStats.map(s => STAT_DISPLAY_NAMES[s]).join(', ');
}

function buildTimeRangeDescription(daysBack?: number): string {
  if (daysBack) {
    return `for the last ${daysBack} days`;
  }
  return '';
}

export function buildObserveMetricsTable(
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
  stats: StatisticKey[],
  options?: {
    daysBack?: number;
    buildNumbersMap?: BuildNumbersMap;
    totalEventCounts?: Map<string, number>;
  }
): string {
  const { versions: results } = buildObserveMetricsJson(metricsMap, metricNames, stats);

  if (results.length === 0) {
    return chalk.yellow('No metrics data found.');
  }

  const displayStats = stats.filter(s => s !== 'eventCount');
  const hasEventCount = stats.includes('eventCount');

  // Build summary header
  const statsDesc = displayStats.length > 0 ? buildStatsDescription(displayStats) : 'Event count';
  const timeDesc = buildTimeRangeDescription(options?.daysBack);
  const countSuffix = hasEventCount && displayStats.length > 0 ? ' (event count)' : '';
  const summaryLine = `${statsDesc} values${countSuffix}${timeDesc ? ` ${timeDesc}` : ''}`;

  // Group results by platform
  const byPlatform = new Map<AppPlatform, ObserveMetricsVersionResult[]>();
  for (const result of results) {
    if (!byPlatform.has(result.platform)) {
      byPlatform.set(result.platform, []);
    }
    byPlatform.get(result.platform)!.push(result);
  }

  // Build metric column headers
  const metricHeaders: string[] = [];
  for (const m of metricNames) {
    const name = getMetricDisplayName(m);
    if (displayStats.length > 0 && hasEventCount) {
      // Merged mode: one column per metric
      metricHeaders.push(name);
    } else {
      // Separate columns per stat
      for (const stat of displayStats.length > 0
        ? displayStats
        : (['eventCount'] as StatisticKey[])) {
        metricHeaders.push(`${name} ${STAT_DISPLAY_NAMES[stat]}`);
      }
    }
  }
  const headers = ['App Version', ...metricHeaders];

  const sections: string[] = [chalk.bold(summaryLine)];

  for (const [platform, platformResults] of byPlatform) {
    sections.push('');
    sections.push(chalk.bold(appPlatformDisplayNames[platform]));

    const rows: string[][] = [];
    for (const result of platformResults) {
      const key = makeMetricsKey(result.appVersion, result.platform);
      const buildNumbers = options?.buildNumbersMap?.get(key);
      const versionLabel = buildNumbers?.length
        ? `${result.appVersion} (${buildNumbers.join(', ')})`
        : result.appVersion;

      const metricCells: string[] = [];
      for (const m of metricNames) {
        const values = result.metrics[m];
        if (displayStats.length > 0 && hasEventCount) {
          for (const stat of displayStats) {
            metricCells.push(
              formatMergedCell(stat, values?.[stat] ?? null, values?.eventCount ?? null)
            );
          }
        } else {
          for (const stat of displayStats.length > 0
            ? displayStats
            : (['eventCount'] as StatisticKey[])) {
            metricCells.push(formatStatValue(stat, values?.[stat] ?? null));
          }
        }
      }

      rows.push([versionLabel, ...metricCells]);
    }

    let footerRow: string[] | undefined;
    if (options?.totalEventCounts) {
      const countCells: string[] = [];
      for (const m of metricNames) {
        const count = options.totalEventCounts.get(`${m}:${platform}`);
        countCells.push(count != null ? count.toLocaleString() : '-');
      }
      if (countCells.some(c => c !== '-')) {
        footerRow = ['Total events', ...countCells];
      }
    }

    sections.push(renderTextTable(headers, rows, footerRow));
  }

  return sections.join('\n');
}
