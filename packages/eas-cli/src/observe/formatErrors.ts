import chalk from 'chalk';

import { AppObserveError, AppObserveErrorGroup, PageInfo } from '../graphql/generated';
import renderTextTable from '../utils/renderTextTable';
import { buildTimeRangeDescription, formatLogTimestamp, formatTimestamp } from './formatUtils';

export interface ObserveErrorGroupJson {
  fingerprint: string | null;
  type: string | null;
  message: string | null;
  source: string | null;
  severity: string | null;
  isFatal: boolean | null;
  eventCount: number | null;
  uniqueUserCount: number | null;
  affectedSessionCount: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  platforms: string[];
}

export interface ObserveErrorJson {
  id: string;
  type: string | null;
  message: string | null;
  source: string | null;
  fingerprint: string | null;
  severityNumber: number | null;
  severityText: string | null;
  isFatal: boolean | null;
  timestamp: string;
  sessionId: string | null;
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

export function buildObserveErrorJson(event: AppObserveError): ObserveErrorJson {
  return {
    id: event.id,
    type: event.type ?? null,
    message: event.message ?? null,
    source: event.source ?? null,
    fingerprint: event.fingerprint ?? null,
    severityNumber: event.severityNumber ?? null,
    severityText: event.severityText ?? null,
    isFatal: event.isFatal ?? null,
    timestamp: event.timestamp,
    sessionId: event.sessionId ?? null,
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
  };
}

/**
 * Render a single error (exception) event as a vertical Field/Value detail
 * table, for `eas observe:event`.
 */
export function buildObserveErrorDetail(event: AppObserveError): string {
  const severity = event.isFatal ? 'fatal' : (event.severityText ?? '-');
  const rows: string[][] = [
    ['ID', event.id],
    ['Type', 'Error'],
    ['Exception', event.type ?? '-'],
    ['Message', event.message ?? '-'],
    ['Source', event.source ?? '-'],
    ['Fingerprint', event.fingerprint ?? '-'],
    ['Severity', severity],
    ['Timestamp', formatLogTimestamp(event.timestamp)],
    ['Session ID', event.sessionId ?? '-'],
    ['App Version', `${event.appVersion} (${event.appBuildNumber})`],
    ['Update ID', event.appUpdateId ?? '-'],
    ['EAS Build ID', event.appEasBuildId ?? '-'],
    ['Platform', `${event.deviceOs} ${event.deviceOsVersion}`],
    ['Device', event.deviceModel],
    ['Country', event.countryCode ?? '-'],
    ['Environment', event.environment ?? '-'],
    ['EAS Client ID', event.easClientId],
  ];
  return [chalk.bold('Error event'), '', renderTextTable(['Field', 'Value'], rows)].join('\n');
}

export interface BuildErrorGroupsTableOptions {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export function buildObserveErrorGroupsTable(
  groups: AppObserveErrorGroup[],
  options?: BuildErrorGroupsTableOptions
): string {
  if (groups.length === 0) {
    return chalk.yellow('No errors found.');
  }

  const headers = [
    'Fingerprint',
    'Type',
    'Message',
    'Severity',
    'Events',
    'Users',
    'Sessions',
    'Last Seen',
  ];
  const rows: string[][] = groups.map(group => [
    group.fingerprint,
    truncate(group.exceptionType ?? '-', 40),
    truncate(group.exceptionMessage ?? '-', 60),
    group.isFatal ? 'fatal' : (group.severity ?? '-').toString().toLowerCase(),
    (group.eventCount ?? 0).toLocaleString(),
    (group.uniqueUserCount ?? 0).toLocaleString(),
    (group.affectedSessionCount ?? 0).toLocaleString(),
    group.lastSeenAt ? formatTimestamp(group.lastSeenAt) : '-',
  ]);

  const lines: string[] = [];
  if (options) {
    const timeDesc = buildTimeRangeDescription(options);
    lines.push(chalk.bold(`Errors ${timeDesc}`.trim()), '');
  }
  lines.push(renderTextTable(headers, rows));
  lines.push(
    '',
    'Pass --fingerprint <fingerprint> to see individual occurrences with stack traces.'
  );
  return lines.join('\n');
}

export function buildObserveErrorGroupsJson(
  groups: AppObserveErrorGroup[],
  isTruncated: boolean
): { errors: ObserveErrorGroupJson[]; isTruncated: boolean } {
  return {
    errors: groups.map(group => ({
      fingerprint: group.fingerprint ?? null,
      type: group.exceptionType ?? null,
      message: group.exceptionMessage ?? null,
      source: group.errorSource ?? null,
      severity: group.severity ?? null,
      isFatal: group.isFatal ?? null,
      eventCount: group.eventCount ?? null,
      uniqueUserCount: group.uniqueUserCount ?? null,
      affectedSessionCount: group.affectedSessionCount ?? null,
      firstSeenAt: group.firstSeenAt ?? null,
      lastSeenAt: group.lastSeenAt ?? null,
      platforms: group.platforms ?? [],
    })),
    isTruncated,
  };
}

export interface ObserveErrorOccurrenceJson {
  id: string;
  type: string | null;
  message: string | null;
  source: string | null;
  fingerprint: string | null;
  severityNumber: number | null;
  severityText: string | null;
  isFatal: boolean | null;
  stacktrace: string | null;
  body: string | null;
  timestamp: string;
  sessionId: string | null;
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
  properties: Array<{ key: string; value: string; type: string }>;
}

export function buildObserveErrorOccurrenceJson(
  occurrence: AppObserveError
): ObserveErrorOccurrenceJson {
  return {
    id: occurrence.id,
    type: occurrence.type ?? null,
    message: occurrence.message ?? null,
    source: occurrence.source ?? null,
    fingerprint: occurrence.fingerprint ?? null,
    severityNumber: occurrence.severityNumber ?? null,
    severityText: occurrence.severityText ?? null,
    isFatal: occurrence.isFatal ?? null,
    stacktrace: occurrence.stacktrace ?? null,
    body: occurrence.body ?? null,
    timestamp: occurrence.timestamp,
    sessionId: occurrence.sessionId ?? null,
    appVersion: occurrence.appVersion,
    appBuildNumber: occurrence.appBuildNumber,
    appUpdateId: occurrence.appUpdateId ?? null,
    appEasBuildId: occurrence.appEasBuildId ?? null,
    deviceModel: occurrence.deviceModel,
    deviceOs: occurrence.deviceOs,
    deviceOsVersion: occurrence.deviceOsVersion,
    countryCode: occurrence.countryCode ?? null,
    environment: occurrence.environment ?? null,
    easClientId: occurrence.easClientId,
    properties: occurrence.properties.map(p => ({ key: p.key, value: p.value, type: p.type })),
  };
}

export function buildObserveErrorOccurrencesJson(
  occurrences: AppObserveError[],
  pageInfo: PageInfo
): {
  occurrences: ObserveErrorOccurrenceJson[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
  return {
    occurrences: occurrences.map(buildObserveErrorOccurrenceJson),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor ?? null,
    },
  };
}

/**
 * Render a single error occurrence as a Field/Value detail table followed by
 * its stack trace (and body, if present), for `eas observe:errors --fingerprint`.
 */
function buildObserveErrorOccurrenceDetail(occurrence: AppObserveError): string {
  const severity = occurrence.isFatal ? 'fatal' : (occurrence.severityText ?? '-');
  const rows: string[][] = [
    ['ID', occurrence.id],
    ['Exception', occurrence.type ?? '-'],
    ['Message', occurrence.message ?? '-'],
    ['Source', occurrence.source ?? '-'],
    ['Severity', severity],
    ['Timestamp', formatLogTimestamp(occurrence.timestamp)],
    ['Session ID', occurrence.sessionId ?? '-'],
    ['App Version', `${occurrence.appVersion} (${occurrence.appBuildNumber})`],
    ['Update ID', occurrence.appUpdateId ?? '-'],
    ['Platform', `${occurrence.deviceOs} ${occurrence.deviceOsVersion}`],
    ['Device', occurrence.deviceModel],
    ['Country', occurrence.countryCode ?? '-'],
    ['Environment', occurrence.environment ?? '-'],
  ];
  const lines = [renderTextTable(['Field', 'Value'], rows)];
  if (occurrence.stacktrace) {
    lines.push('', chalk.bold('Stack trace'), '', occurrence.stacktrace);
  }
  if (occurrence.body) {
    lines.push('', chalk.bold('Body'), '', occurrence.body);
  }
  if (occurrence.properties.length > 0) {
    const propertyRows = occurrence.properties.map(p => [p.key, p.type, p.value]);
    lines.push(
      '',
      chalk.bold('Properties'),
      '',
      renderTextTable(['Key', 'Type', 'Value'], propertyRows)
    );
  }
  return lines.join('\n');
}

export interface BuildErrorOccurrencesOptions {
  fingerprint: string;
  daysBack?: number;
  startTime?: string;
  endTime?: string;
}

export function buildObserveErrorOccurrencesTable(
  occurrences: AppObserveError[],
  pageInfo: PageInfo,
  options: BuildErrorOccurrencesOptions
): string {
  if (occurrences.length === 0) {
    return chalk.yellow(`No occurrences found for fingerprint "${options.fingerprint}".`);
  }

  const timeDesc = buildTimeRangeDescription(options);
  const lines: string[] = [chalk.bold(`Occurrences of ${options.fingerprint} ${timeDesc}`.trim())];
  occurrences.forEach((occurrence, index) => {
    lines.push(
      '',
      chalk.bold(`Occurrence ${index + 1}`),
      '',
      buildObserveErrorOccurrenceDetail(occurrence)
    );
  });

  if (pageInfo.hasNextPage && pageInfo.endCursor) {
    lines.push('', `Next page: --after ${pageInfo.endCursor}`);
  }

  return lines.join('\n');
}
