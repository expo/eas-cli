import chalk from 'chalk';

import { AppObserveEvent } from '../graphql/generated';

const METRIC_SHORT_NAMES: Record<string, string> = {
  'expo.app_startup.cold_launch_time': 'Cold Launch',
  'expo.app_startup.warm_launch_time': 'Warm Launch',
  'expo.app_startup.tti': 'TTI',
  'expo.app_startup.ttr': 'TTR',
  'expo.app_startup.bundle_load_time': 'Bundle Load',
};

function getMetricDisplayName(metricName: string): string {
  return METRIC_SHORT_NAMES[metricName] ?? metricName;
}

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
  deviceModel: string;
  deviceOs: string;
  deviceOsVersion: string;
  countryCode: string | null;
  sessionId: string | null;
  easClientId: string;
  timestamp: string;
}

export function buildObserveEventsTable(events: AppObserveEvent[]): string {
  if (events.length === 0) {
    return chalk.yellow('No events found.');
  }

  const headers = ['Metric', 'Value', 'App Version', 'Platform', 'Device', 'Country', 'Timestamp'];

  const rows: string[][] = events.map(event => [
    getMetricDisplayName(event.metricName),
    `${event.metricValue.toFixed(2)}s`,
    `${event.appVersion} (${event.appBuildNumber})`,
    `${event.deviceOs} ${event.deviceOsVersion}`,
    event.deviceModel,
    event.countryCode ?? '-',
    formatTimestamp(event.timestamp),
  ]);

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  );

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ');
  const separatorLine = colWidths.map(w => '-'.repeat(w)).join('  ');
  const dataLines = rows.map(row =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join('  ')
  );

  return [chalk.bold(headerLine), separatorLine, ...dataLines].join('\n');
}

export function buildObserveEventsJson(events: AppObserveEvent[]): ObserveEventJson[] {
  return events.map(event => ({
    id: event.id,
    metricName: event.metricName,
    metricValue: event.metricValue,
    appVersion: event.appVersion,
    appBuildNumber: event.appBuildNumber,
    deviceModel: event.deviceModel,
    deviceOs: event.deviceOs,
    deviceOsVersion: event.deviceOsVersion,
    countryCode: event.countryCode ?? null,
    sessionId: event.sessionId ?? null,
    easClientId: event.easClientId,
    timestamp: event.timestamp,
  }));
}
