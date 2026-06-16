import chalk from 'chalk';

import { SessionEventEntry, SessionMetadata, SessionSummary } from './fetchSessions';
import { buildTimeRangeDescription, formatLogTimestamp } from './formatUtils';
import { getMetricDisplayName } from './metricNames';
import renderTextTable from '../utils/renderTextTable';

export interface BuildSessionListOptions {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  eventName?: string;
  scannedMetricEventCount?: number;
  scannedLogEventCount?: number;
  isTruncated?: boolean;
}

export function buildObserveSessionListTable(
  sessions: SessionSummary[],
  options?: BuildSessionListOptions
): string {
  const lines: string[] = [];
  if (options) {
    const timeDesc = buildTimeRangeDescription(options);
    const subject = options.eventName
      ? `Sessions containing event "${options.eventName}"`
      : 'Sessions';
    lines.push(chalk.bold(`${subject} ${timeDesc}`.trim()), '');
  }

  if (sessions.length === 0) {
    const emptyMessage = options?.eventName
      ? `No sessions containing event "${options.eventName}" found in the selected time range.`
      : 'No sessions found in the selected time range.';
    lines.push(chalk.yellow(emptyMessage));
    if (options?.scannedMetricEventCount != null || options?.scannedLogEventCount != null) {
      lines.push(
        '',
        `Scanned ${options.scannedMetricEventCount ?? 0} metric events and ${
          options.scannedLogEventCount ?? 0
        } log events.`
      );
    }
    lines.push(
      chalk.yellow(
        'Note: this command scans the most recent 100 metric events and 100 log events; older sessions in this window may not be listed.'
      )
    );
    return lines.join('\n');
  }

  const headers = ['Session ID', 'First seen', 'App version'];

  const byPlatform = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    if (!byPlatform.has(s.deviceOs)) {
      byPlatform.set(s.deviceOs, []);
    }
    byPlatform.get(s.deviceOs)!.push(s);
  }

  for (const [platform, platformSessions] of byPlatform) {
    lines.push(chalk.bold(platform), '');
    const rows: string[][] = platformSessions.map(s => [
      s.sessionId,
      formatLogTimestamp(s.firstSeenAt),
      `${s.appVersion} (${s.appBuildNumber})`,
    ]);
    lines.push(renderTextTable(headers, rows), '');
  }

  if (options?.scannedMetricEventCount != null || options?.scannedLogEventCount != null) {
    lines.push(
      '',
      `Derived from ${options.scannedMetricEventCount ?? 0} metric events and ${
        options.scannedLogEventCount ?? 0
      } log events.`
    );
  }

  lines.push(
    chalk.yellow(
      'Note: this command scans the most recent 100 metric events and 100 log events; older sessions in this window may not be listed.'
    )
  );

  return lines.join('\n');
}

export interface ObserveSessionListJson {
  sessions: SessionSummary[];
  scannedMetricEventCount: number;
  scannedLogEventCount: number;
  isTruncated: boolean;
}

export function buildObserveSessionListJson(
  sessions: SessionSummary[],
  scannedMetricEventCount: number,
  scannedLogEventCount: number,
  isTruncated: boolean
): ObserveSessionListJson {
  return {
    sessions,
    scannedMetricEventCount,
    scannedLogEventCount,
    isTruncated,
  };
}

export interface BuildSessionEventsOptions {
  metadata?: SessionMetadata | null;
  hasMoreMetricEvents?: boolean;
  hasMoreLogEvents?: boolean;
}

function formatEntryName(entry: SessionEventEntry): string {
  if (entry.source === 'metric' && entry.metricName) {
    return getMetricDisplayName(entry.metricName);
  }
  return entry.eventName ?? '-';
}

function formatEntryValue(entry: SessionEventEntry): string {
  if (entry.source === 'metric' && typeof entry.metricValue === 'number') {
    return `${entry.metricValue.toFixed(2)}s`;
  }
  if (entry.source === 'log') {
    if (entry.severityText) {
      return entry.severityText;
    }
    if (entry.severityNumber != null) {
      return String(entry.severityNumber);
    }
  }
  return '-';
}

export function buildObserveSessionEventsTable(
  entries: SessionEventEntry[],
  sessionId: string,
  options?: BuildSessionEventsOptions
): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`Session ${sessionId}`));

  if (options?.metadata) {
    const { metadata } = options;
    lines.push(
      `App version: ${metadata.appVersion} (${metadata.appBuildNumber})`,
      `Device:      ${metadata.deviceModel} · ${metadata.deviceOs} ${metadata.deviceOsVersion}`,
      `First seen:  ${formatLogTimestamp(metadata.firstSeenAt)}`,
      `Last seen:   ${formatLogTimestamp(metadata.lastSeenAt)}`
    );
  }
  lines.push('');

  if (entries.length === 0) {
    lines.push(chalk.yellow('No events found for this session.'));
    return lines.join('\n');
  }

  const headers = ['Timestamp', 'Type', 'Name', 'Value / Severity'];
  const rows: string[][] = entries.map(entry => [
    formatLogTimestamp(entry.timestamp),
    entry.source === 'metric' ? 'metric' : 'log',
    formatEntryName(entry),
    formatEntryValue(entry),
  ]);

  lines.push(renderTextTable(headers, rows));

  if (options?.hasMoreMetricEvents || options?.hasMoreLogEvents) {
    const sources: string[] = [];
    if (options.hasMoreMetricEvents) {
      sources.push('metric events');
    }
    if (options.hasMoreLogEvents) {
      sources.push('log events');
    }
    lines.push(
      '',
      chalk.yellow(
        `More ${sources.join(' and ')} are available for this session — use --limit to fetch more per source.`
      )
    );
  }

  return lines.join('\n');
}

export interface ObserveSessionEventsJson {
  sessionId: string;
  metadata: SessionMetadata | null;
  entries: SessionEventEntry[];
  hasMoreMetricEvents: boolean;
  hasMoreLogEvents: boolean;
}

export function buildObserveSessionEventsJson(
  entries: SessionEventEntry[],
  sessionId: string,
  metadata: SessionMetadata | null,
  hasMoreMetricEvents: boolean,
  hasMoreLogEvents: boolean
): ObserveSessionEventsJson {
  return {
    sessionId,
    metadata,
    entries,
    hasMoreMetricEvents,
    hasMoreLogEvents,
  };
}
