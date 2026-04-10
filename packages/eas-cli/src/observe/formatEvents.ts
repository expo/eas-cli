import chalk from 'chalk';

import { AppObserveEvent, PageInfo } from '../graphql/generated';
import { getMetricDisplayName } from './metricNames';

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export interface BuildEventsTableOptions {
  metricName: string;
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

  const headers = [
    'Value',
    'App Version',
    ...(hasUpdates ? ['Update'] : []),
    'Platform',
    'Device',
    'Country',
    'Timestamp',
  ];

  const rows: string[][] = events.map(event => [
    `${event.metricValue.toFixed(2)}s`,
    `${event.appVersion} (${event.appBuildNumber})`,
    ...(hasUpdates ? [event.appUpdateId ?? '-'] : []),
    `${event.deviceOs} ${event.deviceOsVersion}`,
    event.deviceModel,
    event.countryCode ?? '-',
    formatTimestamp(event.timestamp),
  ]);

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  const separatorLine = colWidths.map(w => '-'.repeat(w)).join('  ');
  const dataLines = rows.map(row => row.map((cell, i) => cell.padEnd(colWidths[i])).join('  '));

  const lines: string[] = [];

  if (options) {
    const metricDisplay = getMetricDisplayName(options.metricName);
    let timeDesc: string;
    if (options.daysBack) {
      timeDesc = `for the last ${options.daysBack} days`;
    } else if (options.startTime && options.endTime) {
      timeDesc = `from ${formatDate(options.startTime)} to ${formatDate(options.endTime)}`;
    } else {
      timeDesc = '';
    }
    const totalDesc =
      options.totalEventCount != null
        ? ` — ${options.totalEventCount.toLocaleString()} total events`
        : '';
    lines.push(chalk.bold(`${metricDisplay} events ${timeDesc}${totalDesc}`.trim()), '');
  }

  lines.push(chalk.bold(headerLine), separatorLine, ...dataLines);

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
    })),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor ?? null,
    },
  };
}
