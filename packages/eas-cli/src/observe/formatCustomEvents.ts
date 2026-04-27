import chalk from 'chalk';

import { AppObserveCustomEvent, PageInfo } from '../graphql/generated';
import renderTextTable from '../utils/renderTextTable';
import { buildTimeRangeDescription, formatTimestamp } from './formatUtils';

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
  const hasSeverity = events.some(e => e.severityText);

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
    formatTimestamp(event.timestamp),
    ...(showEventName ? [event.eventName] : []),
    ...(hasSeverity ? [event.severityText ?? '-'] : []),
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
