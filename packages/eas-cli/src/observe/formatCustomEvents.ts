import chalk from 'chalk';

import { AppObserveCustomEvent, AppObserveCustomEventName, PageInfo } from '../graphql/generated';
import renderTextTable from '../utils/renderTextTable';
import { buildTimeRangeDescription, formatLogTimestamp } from './formatUtils';

function formatSeverity(event: AppObserveCustomEvent): string {
  if (event.severityText) {
    return event.severityText;
  }
  if (event.severityNumber != null) {
    return String(event.severityNumber);
  }
  return '-';
}

export interface ObserveCustomEventPropertyJson {
  key: string;
  value: string;
  type: string;
}

export interface ObserveCustomEventJson {
  id: string;
  eventName: string;
  timestamp: string;
  sessionId: string | null;
  severityNumber: number | null;
  severityText: string | null;
  properties: ObserveCustomEventPropertyJson[];
  appVersion: string;
  appBuildNumber: string;
  appUpdateId: string | null;
  appEasBuildId: string | null;
  deviceModel: string;
  deviceOs: string;
  deviceOsVersion: string;
  countryCode: string | null;
  environment: string | null;
  easClientId: string;
}

export interface BuildCustomEventsTableOptions {
  eventName?: string;
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  totalEventCount?: number;
}

export function buildObserveCustomEventsTable(
  events: AppObserveCustomEvent[],
  pageInfo: PageInfo,
  options?: BuildCustomEventsTableOptions
): string {
  if (events.length === 0) {
    return chalk.yellow('No custom events found.');
  }

  const showEventName = !options?.eventName;
  const hasSeverity = events.some(e => e.severityText != null || e.severityNumber != null);

  const headers = [
    'Timestamp',
    ...(showEventName ? ['Event'] : []),
    ...(hasSeverity ? ['Severity'] : []),
    'App Version',
    'Platform',
    'Device',
    'Country',
  ];

  const rows: string[][] = events.map(event => [
    formatLogTimestamp(event.timestamp),
    ...(showEventName ? [event.eventName] : []),
    ...(hasSeverity ? [formatSeverity(event)] : []),
    `${event.appVersion} (${event.appBuildNumber})`,
    `${event.deviceOs} ${event.deviceOsVersion}`,
    event.deviceModel,
    event.countryCode ?? '-',
  ]);

  const lines: string[] = [];

  if (options) {
    const timeDesc = buildTimeRangeDescription(options);
    const totalDesc =
      options.totalEventCount != null
        ? ` — ${options.totalEventCount.toLocaleString()} total events`
        : '';
    const subject = options.eventName ? `${options.eventName} events` : 'Custom events';
    lines.push(chalk.bold(`${subject} ${timeDesc}${totalDesc}`.trim()), '');
  }

  lines.push(renderTextTable(headers, rows));

  if (pageInfo.hasNextPage && pageInfo.endCursor) {
    lines.push('', `Next page: --after ${pageInfo.endCursor}`);
  }

  return lines.join('\n');
}

export function buildObserveCustomEventsJson(
  events: AppObserveCustomEvent[],
  pageInfo: PageInfo
): {
  events: ObserveCustomEventJson[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
  return {
    events: events.map(event => ({
      id: event.id,
      eventName: event.eventName,
      timestamp: event.timestamp,
      sessionId: event.sessionId ?? null,
      severityNumber: event.severityNumber ?? null,
      severityText: event.severityText ?? null,
      properties: event.properties.map(p => ({
        key: p.key,
        value: p.value,
        type: p.type,
      })),
      appVersion: event.appVersion,
      appBuildNumber: event.appBuildNumber,
      appUpdateId: event.appUpdateId ?? null,
      appEasBuildId: event.appEasBuildId ?? null,
      deviceModel: event.deviceModel,
      deviceOs: event.deviceOs,
      deviceOsVersion: event.deviceOsVersion,
      countryCode: event.countryCode ?? null,
      environment: event.environment ?? null,
      easClientId: event.easClientId,
    })),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor ?? null,
    },
  };
}

export interface BuildEmptyCustomEventsWithSuggestionsOptions {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  isTruncated?: boolean;
}

export function buildObserveCustomEventsEmptyWithSuggestionsTable(
  eventName: string,
  names: AppObserveCustomEventName[],
  options?: BuildEmptyCustomEventsWithSuggestionsOptions
): string {
  const lines: string[] = [];
  const timeDesc = options ? buildTimeRangeDescription(options) : '';
  lines.push(chalk.yellow(`No events found matching "${eventName}" ${timeDesc}.`.trim()));

  if (names.length === 0) {
    lines.push('', chalk.yellow('No custom event names found in this time range.'));
    return lines.join('\n');
  }

  lines.push('', 'Available event names in this time range:', '');

  const headers = ['Event Name', 'Count'];
  const rows: string[][] = names.map(n => [n.eventName, n.count.toLocaleString()]);
  lines.push(renderTextTable(headers, rows));

  if (options?.isTruncated) {
    lines.push('', chalk.yellow('Result is truncated; not all event names are shown.'));
  }

  return lines.join('\n');
}

export function buildObserveCustomEventsEmptyWithSuggestionsJson(
  eventName: string,
  names: AppObserveCustomEventName[],
  isTruncated: boolean
): {
  filteredEventName: string;
  events: [];
  availableEventNames: Array<{ eventName: string; count: number }>;
  availableEventNamesIsTruncated: boolean;
} {
  return {
    filteredEventName: eventName,
    events: [],
    availableEventNames: names.map(n => ({ eventName: n.eventName, count: n.count })),
    availableEventNamesIsTruncated: isTruncated,
  };
}

export interface BuildCustomEventNamesTableOptions {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  isTruncated?: boolean;
}

export function buildObserveCustomEventNamesTable(
  names: AppObserveCustomEventName[],
  options?: BuildCustomEventNamesTableOptions
): string {
  if (names.length === 0) {
    return chalk.yellow('No custom event names found.');
  }

  const headers = ['Event Name', 'Count'];
  const rows: string[][] = names.map(n => [n.eventName, n.count.toLocaleString()]);

  const lines: string[] = [];

  if (options) {
    const timeDesc = buildTimeRangeDescription(options);
    const subject = 'Custom event names';
    lines.push(chalk.bold(`${subject} ${timeDesc}`.trim()), '');
  }

  lines.push(renderTextTable(headers, rows));

  if (options?.isTruncated) {
    lines.push('', chalk.yellow('Result is truncated; not all event names are shown.'));
  }

  return lines.join('\n');
}

export function buildObserveCustomEventNamesJson(
  names: AppObserveCustomEventName[],
  isTruncated: boolean
): { names: Array<{ eventName: string; count: number }>; isTruncated: boolean } {
  return {
    names: names.map(n => ({ eventName: n.eventName, count: n.count })),
    isTruncated,
  };
}
