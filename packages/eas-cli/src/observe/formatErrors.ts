import chalk from 'chalk';

import { AppObserveErrorGroup } from '../graphql/generated';
import renderTextTable from '../utils/renderTextTable';
import { buildTimeRangeDescription, formatTimestamp } from './formatUtils';

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

  const headers = ['Type', 'Message', 'Severity', 'Events', 'Users', 'Sessions', 'Last Seen'];
  const rows: string[][] = groups.map(group => [
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
