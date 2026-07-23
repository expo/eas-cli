import chalk from 'chalk';

import { AppObserveEvent, PageInfo } from '../graphql/generated';
import renderTextTable from '../utils/renderTextTable';
import { buildTimeRangeDescription, formatTimestamp } from './formatUtils';
import { getMetricDisplayName } from './metricNames';

export interface ObserveEventJson {
  id: string;
  metricName: string;
  metricValue: number;
  appVersion: string;
  appBuildNumber: string;
  appUpdateId: string | null;
  deviceModel: string;
  deviceOs: string;
  deviceOsVersion: string;
  countryCode: string | null;
  sessionId: string | null;
  easClientId: string;
  timestamp: string;
  customParams: { [key: string]: any } | null;
  routeName: string | null;
}

function resolveCustomParams(event: AppObserveEvent): { [key: string]: any } | null {
  return event.customParams ?? null;
}

export interface BuildEventsTableOptions {
  /** Omit to render samples across all metrics (adds a "Metric" column). */
  metricName?: string;
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  totalEventCount?: number;
}

export function buildObserveEventsTable(
  events: AppObserveEvent[],
  pageInfo: PageInfo,
  options?: BuildEventsTableOptions
): string {
  if (events.length === 0) {
    return chalk.yellow('No events found.');
  }

  const hasUpdates = events.some(e => e.appUpdateId);
  // When no single metric is requested (--all-metrics), samples span multiple
  // metrics, so show which metric each row belongs to.
  const showMetricColumn = !!options && !options.metricName;

  const headers = [
    ...(showMetricColumn ? ['Metric'] : []),
    'Value',
    'App Version',
    ...(hasUpdates ? ['Update'] : []),
    'Platform',
    'Device',
    'Country',
    'Timestamp',
  ];

  const rows: string[][] = events.map(event => [
    ...(showMetricColumn ? [getMetricDisplayName(event.metricName)] : []),
    `${event.metricValue.toFixed(2)}s`,
    `${event.appVersion} (${event.appBuildNumber})`,
    ...(hasUpdates ? [event.appUpdateId ?? '-'] : []),
    `${event.deviceOs} ${event.deviceOsVersion}`,
    event.deviceModel,
    event.countryCode ?? '-',
    formatTimestamp(event.timestamp),
  ]);

  const lines: string[] = [];

  if (options) {
    const heading = options.metricName
      ? `${getMetricDisplayName(options.metricName)} events`
      : 'All metric events';
    const timeDesc = buildTimeRangeDescription(options);
    const totalDesc =
      options.totalEventCount != null
        ? ` — ${options.totalEventCount.toLocaleString()} total events`
        : '';
    lines.push(chalk.bold(`${heading} ${timeDesc}${totalDesc}`.trim()), '');
  }

  lines.push(renderTextTable(headers, rows));

  if (pageInfo.hasNextPage && pageInfo.endCursor) {
    lines.push('', `Next page: --after ${pageInfo.endCursor}`);
  }

  return lines.join('\n');
}

export function buildObserveEventsJson(
  events: AppObserveEvent[],
  pageInfo: PageInfo
): { events: ObserveEventJson[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } {
  return {
    events: events.map(event => ({
      id: event.id,
      metricName: event.metricName,
      metricValue: event.metricValue,
      appVersion: event.appVersion,
      appBuildNumber: event.appBuildNumber,
      appUpdateId: event.appUpdateId ?? null,
      deviceModel: event.deviceModel,
      deviceOs: event.deviceOs,
      deviceOsVersion: event.deviceOsVersion,
      countryCode: event.countryCode ?? null,
      sessionId: event.sessionId ?? null,
      easClientId: event.easClientId,
      timestamp: event.timestamp,
      customParams: resolveCustomParams(event),
      routeName: event.routeName ?? null,
    })),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor ?? null,
    },
  };
}
