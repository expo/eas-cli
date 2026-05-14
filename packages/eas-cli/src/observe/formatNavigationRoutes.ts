import chalk from 'chalk';

import { EasCommandError } from '../commandUtils/errors';
import { AppPlatform } from '../graphql/generated';
import { appPlatformDisplayNames } from '../platform';
import renderTextTable from '../utils/renderTextTable';
import { NavigationRouteWithPlatform } from './fetchNavigationRoutes';
import { buildTimeRangeDescription } from './formatUtils';
import { getMetricDisplayName } from './metricNames';

export type NavigationStatKey = 'median' | 'p90' | 'count';

export const NAVIGATION_STAT_ALIASES: Record<string, NavigationStatKey> = {
  med: 'median',
  median: 'median',
  p90: 'p90',
  count: 'count',
  event_count: 'count',
  eventCount: 'count',
};

export const NAVIGATION_STAT_DISPLAY_NAMES: Record<NavigationStatKey, string> = {
  median: 'Med',
  p90: 'P90',
  count: 'Count',
};

export function resolveNavigationStatKey(input: string): NavigationStatKey {
  const resolved = NAVIGATION_STAT_ALIASES[input];
  if (resolved) {
    return resolved;
  }
  throw new EasCommandError(
    `Unknown statistic: "${input}". Valid options: ${Object.keys(NAVIGATION_STAT_ALIASES).join(
      ', '
    )}`
  );
}

type NavigationRouteField = 'coldTtr' | 'warmTtr' | 'tti';

const FULL_METRIC_NAME_TO_FIELD: Record<string, NavigationRouteField> = {
  'expo.navigation.cold_ttr': 'coldTtr',
  'expo.navigation.warm_ttr': 'warmTtr',
  'expo.navigation.tti': 'tti',
};

export const NAVIGATION_METRIC_NAMES = Object.keys(FULL_METRIC_NAME_TO_FIELD);

export function isNavigationMetric(metricName: string): boolean {
  return metricName in FULL_METRIC_NAME_TO_FIELD;
}

function formatStatValue(stat: NavigationStatKey, value: number | null | undefined): string {
  if (value == null) {
    return '-';
  }
  if (stat === 'count') {
    return String(value);
  }
  return `${value.toFixed(2)}s`;
}

function formatMergedCell(
  stat: NavigationStatKey,
  statValue: number | null | undefined,
  count: number | null | undefined
): string {
  const formatted = formatStatValue(stat, statValue);
  const countStr = count != null ? String(count) : '-';
  return `${formatted} (${countStr})`;
}

export interface NavigationRouteValuesJson {
  routeName: string;
  platform: AppPlatform;
  metrics: Record<string, Partial<Record<NavigationStatKey, number | null>>>;
}

export interface ObserveNavigationRoutesJsonOutput {
  routes: NavigationRouteValuesJson[];
  pageInfoByPlatform: Record<string, { hasNextPage: boolean; endCursor: string | null }>;
}

function metricStat(
  node: NavigationRouteWithPlatform,
  metricName: string
): { count: number; median: number | null; p90: number | null } {
  const field = FULL_METRIC_NAME_TO_FIELD[metricName];
  if (!field) {
    throw new EasCommandError(`Unknown navigation metric: "${metricName}"`);
  }
  const stat = node.route[field];
  return {
    count: stat.count,
    median: stat.median ?? null,
    p90: stat.p90 ?? null,
  };
}

export function buildObserveNavigationRoutesJson(
  routes: NavigationRouteWithPlatform[],
  metricNames: string[],
  stats: NavigationStatKey[],
  pageInfoByPlatform: Map<AppPlatform, { hasNextPage: boolean; endCursor?: string | null }>
): ObserveNavigationRoutesJsonOutput {
  const jsonRoutes: NavigationRouteValuesJson[] = routes.map(node => {
    const metrics: Record<string, Partial<Record<NavigationStatKey, number | null>>> = {};
    for (const metricName of metricNames) {
      const values = metricStat(node, metricName);
      const statValues: Partial<Record<NavigationStatKey, number | null>> = {};
      for (const stat of stats) {
        statValues[stat] = values[stat] ?? null;
      }
      metrics[metricName] = statValues;
    }
    return {
      routeName: node.route.routeName,
      platform: node.platform,
      metrics,
    };
  });

  const pageInfoByPlatformOutput: Record<
    string,
    { hasNextPage: boolean; endCursor: string | null }
  > = {};
  for (const [platform, pageInfo] of pageInfoByPlatform) {
    pageInfoByPlatformOutput[platform] = {
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor ?? null,
    };
  }

  return { routes: jsonRoutes, pageInfoByPlatform: pageInfoByPlatformOutput };
}

export interface BuildNavigationRoutesTableOptions {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  pageInfoByPlatform?: Map<AppPlatform, { hasNextPage: boolean; endCursor?: string | null }>;
}

export function buildObserveNavigationRoutesTable(
  routes: NavigationRouteWithPlatform[],
  metricNames: string[],
  stats: NavigationStatKey[],
  options?: BuildNavigationRoutesTableOptions
): string {
  if (routes.length === 0) {
    return chalk.yellow('No navigation routes found.');
  }

  const displayStats = stats.filter(s => s !== 'count');
  const hasCount = stats.includes('count');

  const statsDesc =
    displayStats.length > 0
      ? displayStats.map(s => NAVIGATION_STAT_DISPLAY_NAMES[s]).join(', ')
      : 'Navigation count';
  const timeDesc = buildTimeRangeDescription({
    daysBack: options?.daysBack,
    startTime: options?.startTime,
    endTime: options?.endTime,
  });
  const countSuffix = hasCount && displayStats.length > 0 ? ' (navigation count)' : '';
  const summaryLine = `${statsDesc} values${countSuffix}${timeDesc ? ` ${timeDesc}` : ''}`;

  const byPlatform = new Map<AppPlatform, NavigationRouteWithPlatform[]>();
  for (const node of routes) {
    if (!byPlatform.has(node.platform)) {
      byPlatform.set(node.platform, []);
    }
    byPlatform.get(node.platform)!.push(node);
  }

  const metricHeaders: string[] = [];
  for (const metricName of metricNames) {
    const displayName = getMetricDisplayName(metricName);
    if (displayStats.length > 0 && hasCount) {
      for (const stat of displayStats) {
        metricHeaders.push(
          displayStats.length > 1
            ? `${displayName} ${NAVIGATION_STAT_DISPLAY_NAMES[stat]}`
            : displayName
        );
      }
    } else {
      for (const stat of displayStats.length > 0
        ? displayStats
        : (['count'] as NavigationStatKey[])) {
        metricHeaders.push(
          displayStats.length === 0
            ? `${displayName} Count`
            : `${displayName} ${NAVIGATION_STAT_DISPLAY_NAMES[stat]}`
        );
      }
    }
  }
  const headers = ['Route', ...metricHeaders];

  const sections: string[] = [chalk.bold(summaryLine)];

  for (const [platform, platformRoutes] of byPlatform) {
    sections.push('');
    sections.push(chalk.bold(appPlatformDisplayNames[platform]));

    const rows: string[][] = platformRoutes.map(node => {
      const cells: string[] = [];
      for (const metricName of metricNames) {
        const values = metricStat(node, metricName);
        if (displayStats.length > 0 && hasCount) {
          for (const stat of displayStats) {
            cells.push(formatMergedCell(stat, values[stat], values.count));
          }
        } else {
          for (const stat of displayStats.length > 0
            ? displayStats
            : (['count'] as NavigationStatKey[])) {
            cells.push(formatStatValue(stat, values[stat]));
          }
        }
      }
      return [node.route.routeName, ...cells];
    });

    sections.push(renderTextTable(headers, rows));

    const pageInfo = options?.pageInfoByPlatform?.get(platform);
    if (pageInfo?.hasNextPage && pageInfo.endCursor) {
      sections.push(
        `Next page (${appPlatformDisplayNames[platform]}): --after ${pageInfo.endCursor}`
      );
    }
  }

  return sections.join('\n');
}
