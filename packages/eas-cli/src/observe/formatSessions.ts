import chalk from 'chalk';

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
