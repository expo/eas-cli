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

  const startIso = entries[0].timestamp;
  const headers = ['Offset', 'Type', 'Name', 'Value', 'Severity'];
  const rows: string[][] = [];
  for (const entry of entries) {
    const offset = formatOffsetSeconds(startIso, entry.timestamp);
    const type = entry.source === 'metric' ? 'metric' : 'log';
    const name = formatEntryName(entry);
    const severity = formatEntrySeverity(entry);
    if (entry.source === 'metric') {
      rows.push([offset, type, name, formatMetricEntryValue(entry), severity]);
      continue;
    }
    const propLines = primitivePropertyLines(entry);
    if (propLines.length === 0) {
      rows.push([offset, type, name, '-', severity]);
      continue;
    }
    rows.push([offset, type, name, propLines[0], severity]);
    for (let i = 1; i < propLines.length; i++) {
      rows.push(['', '', '', propLines[i], '']);
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
