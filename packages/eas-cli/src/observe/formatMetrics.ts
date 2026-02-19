import chalk from 'chalk';

import { EasCommandError } from '../commandUtils/errors';
import { AppPlatform, BuildFragment } from '../graphql/generated';
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

export const DEFAULT_STATS_TABLE: StatisticKey[] = ['median', 'eventCount'];
export const DEFAULT_STATS_JSON: StatisticKey[] = [
  'min',
  'median',
  'max',
  'average',
  'p80',
  'p90',
  'p99',
  'eventCount',
];

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

interface VersionGroup {
  appVersion: string;
  platform: AppPlatform;
  commits: Set<string>;
  lastBuildDate: string | null;
}

function groupBuildsByVersion(builds: BuildFragment[]): VersionGroup[] {
  const grouped = new Map<ObserveMetricsKey, VersionGroup>();

  for (const build of builds) {
    const version = build.appVersion ?? '-';
    const key = makeMetricsKey(version, build.platform);

    if (!grouped.has(key)) {
      grouped.set(key, {
        appVersion: version,
        platform: build.platform,
        commits: new Set(),
        lastBuildDate: build.completedAt ?? null,
      });
    } else {
      const group = grouped.get(key)!;
      if (build.completedAt && (!group.lastBuildDate || build.completedAt > group.lastBuildDate)) {
        group.lastBuildDate = build.completedAt;
      }
    }

    if (build.gitCommitHash) {
      grouped.get(key)!.commits.add(build.gitCommitHash.slice(0, 7));
    }
  }

  return [...grouped.values()];
}

function formatDate(dateString: string | null): string {
  if (!dateString) {
    return '-';
  }
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export type MetricValuesJson = Partial<Record<StatisticKey, number | null>>;

export interface ObserveMetricsVersionResult {
  appVersion: string | null;
  platform: AppPlatform;
  lastBuildDate: string | null;
  commits: string[];
  metrics: Record<string, MetricValuesJson>;
}

export function buildObserveMetricsJson(
  builds: BuildFragment[],
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
  stats: StatisticKey[]
): ObserveMetricsVersionResult[] {
  const groups = groupBuildsByVersion(builds);

  return groups.map(group => {
    const key = group.appVersion !== '-' ? makeMetricsKey(group.appVersion, group.platform) : null;
    const versionMetrics = key ? metricsMap.get(key) : undefined;

    const metrics: Record<string, MetricValuesJson> = {};
    for (const metricName of metricNames) {
      const values = versionMetrics?.get(metricName);
      const statValues: MetricValuesJson = {};
      for (const stat of stats) {
        statValues[stat] = values?.[stat] ?? null;
      }
      metrics[metricName] = statValues;
    }

    return {
      appVersion: group.appVersion !== '-' ? group.appVersion : null,
      platform: group.platform,
      lastBuildDate: group.lastBuildDate,
      commits: [...group.commits],
      metrics,
    };
  });
}

export function buildObserveMetricsTable(
  builds: BuildFragment[],
  metricsMap: ObserveMetricsMap,
  metricNames: string[],
  stats: StatisticKey[]
): string {
  const results = buildObserveMetricsJson(builds, metricsMap, metricNames, stats);

  if (results.length === 0) {
    return chalk.yellow('No finished builds found.');
  }

  const fixedHeaders = ['App Version', 'Platform', 'Last Build', 'Commits'];
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

    return [
      result.appVersion ?? '-',
      appPlatformDisplayNames[result.platform],
      formatDate(result.lastBuildDate),
      result.commits.length > 0 ? result.commits.join(', ') : '-',
      ...metricCells,
    ];
  });

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  const separatorLine = colWidths.map(w => '-'.repeat(w)).join('  ');
  const dataLines = rows.map(row => row.map((cell, i) => cell.padEnd(colWidths[i])).join('  '));

  return [chalk.bold(headerLine), separatorLine, ...dataLines].join('\n');
}
