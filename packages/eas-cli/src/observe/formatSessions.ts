import chalk from 'chalk';

import { AppObserveCustomEvent, AppObserveEvent } from '../graphql/generated';
import { SessionEventEntry, SessionMetadata } from './fetchSessions';
import { formatLogTimestamp } from './formatUtils';
import { getMetricDisplayName } from './metricNames';
import renderTextTable from '../utils/renderTextTable';

export interface BuildSessionEventsOptions {
  metadata?: SessionMetadata | null;
  hasMoreMetricEvents?: boolean;
  hasMoreLogEvents?: boolean;
}

function formatEntryName(entry: SessionEventEntry): string {
  if (entry.source === 'metric' && entry.metricName) {
    const name = getMetricDisplayName(entry.metricName);
    return entry.routeName ? `${name} · ${entry.routeName}` : name;
  }
  return entry.eventName ?? '-';
}

function formatMetricEntryValue(entry: SessionEventEntry): string {
  if (typeof entry.metricValue === 'number') {
    return `${entry.metricValue.toFixed(2)}s`;
  }
  return '-';
}

function formatEntrySeverity(entry: SessionEventEntry): string {
  if (entry.source !== 'log') {
    return '-';
  }
  if (entry.severityText) {
    return entry.severityText;
  }
  if (entry.severityNumber != null) {
    return String(entry.severityNumber);
  }
  return '-';
}

function primitivePropertyLines(entry: SessionEventEntry): string[] {
  if (entry.source !== 'log' || !entry.properties) {
    return [];
  }
  return entry.properties
    .filter(p => p.type === 'STRING' || p.type === 'NUMBER' || p.type === 'BOOLEAN')
    .map(p => `${p.key}=${p.value}`);
}

function formatOffsetSeconds(startIso: string, currentIso: string): string {
  const offsetMs = new Date(currentIso).getTime() - new Date(startIso).getTime();
  return `${(offsetMs / 1000).toFixed(2)}s`;
}

export function buildObserveSessionEventsTable(
  entries: SessionEventEntry[],
  options?: BuildSessionEventsOptions
): string {
  const lines: string[] = [];

  if (options?.metadata) {
    const { metadata } = options;
    lines.push(
      `App version: ${metadata.appVersion} (${metadata.appBuildNumber})`,
      `Device:      ${metadata.deviceModel} · ${metadata.deviceOs} ${metadata.deviceOsVersion}`,
      `First seen:  ${formatLogTimestamp(metadata.firstSeenAt)}`,
      `Last seen:   ${formatLogTimestamp(metadata.lastSeenAt)}`,
      ''
    );
  }

  if (entries.length === 0) {
    lines.push(chalk.yellow('No events found for this session.'));
    return lines.join('\n');
  }

  const startIso = entries[0].timestamp;
  const headers = ['Offset', 'Type', 'Name', 'Value', 'Properties', 'Severity'];
  const rows: string[][] = [];
  for (const entry of entries) {
    const offset = formatOffsetSeconds(startIso, entry.timestamp);
    const type = entry.source === 'metric' ? 'metric' : 'log';
    const name = formatEntryName(entry);
    const severity = formatEntrySeverity(entry);
    if (entry.source === 'metric') {
      rows.push([offset, type, name, formatMetricEntryValue(entry), '-', severity]);
      continue;
    }
    const propLines = primitivePropertyLines(entry);
    if (propLines.length === 0) {
      rows.push([offset, type, name, '-', '-', severity]);
      continue;
    }
    rows.push([offset, type, name, '-', propLines[0], severity]);
    for (let i = 1; i < propLines.length; i++) {
      rows.push(['', '', '', '', propLines[i], '']);
    }
  }

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
        `More ${sources.join(' and ')} are available for this session; only the first 100 of each are shown.`
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

/**
 * Compact session ID for display in candidate lists — long UUIDs are
 * truncated to `<first-8>…<last-4>` so a row stays scannable.
 */
export function shortSessionId(sessionId: string): string {
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`;
}

/**
 * One-line title for a metric event shown in the observe:session candidate
 * picker, e.g. `Jan 15, 10:00:00.000 AM · Startup TTI 1.23s · 1.0.0 · iOS 17.0 · session abc…1234`.
 */
export function formatMetricCandidateTitle(event: AppObserveEvent): string {
  const displayName = getMetricDisplayName(event.metricName);
  const value = `${event.metricValue.toFixed(2)}s`;
  const timestamp = formatLogTimestamp(event.timestamp);
  const shortSession = shortSessionId(event.sessionId ?? '');
  const device = `${event.deviceOs} ${event.deviceOsVersion}`;
  return `${timestamp} · ${displayName} ${value} · ${event.appVersion} · ${device} · session ${shortSession}`;
}

/**
 * One-line title for a custom log event shown in the observe:session
 * candidate picker.
 */
export function formatLogCandidateTitle(event: AppObserveCustomEvent): string {
  const timestamp = formatLogTimestamp(event.timestamp);
  const severity =
    event.severityText ?? (event.severityNumber != null ? String(event.severityNumber) : '-');
  const shortSession = shortSessionId(event.sessionId ?? '');
  const device = `${event.deviceOs} ${event.deviceOsVersion}`;
  return `${timestamp} · ${event.eventName} · ${severity} · ${event.appVersion} · ${device} · session ${shortSession}`;
}
