import chalk from 'chalk';

import {
  AppObserveSpan,
  AppObserveSpanName,
  AppObserveTrace,
  PageInfo,
} from '../graphql/generated';
import renderTextTable from '../utils/renderTextTable';
import { sanitizeTerminalText } from '../utils/terminalText';
import { buildTimeRangeDescription, formatLogTimestamp } from './formatUtils';

export function formatSpanDuration(durationMs: number): string {
  const wholeMs = Math.round(durationMs);
  if (wholeMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  }
  return `${wholeMs}ms`;
}

/**
 * The HTTP response status code, or the client-side error type when the
 * request got no response, or "-" for a span that is not an HTTP request.
 */
export function formatSpanHttpStatus(span: AppObserveSpan): string {
  if (span.http?.statusCode != null) {
    return String(span.http.statusCode);
  }
  return span.http?.errorType ?? '-';
}

/** The path and query of a full URL; the URL itself when it does not parse. */
export function formatSpanUrlPath(urlFull: string): string {
  try {
    const url = new URL(urlFull);
    return `${url.pathname}${url.search}`;
  } catch {
    return urlFull;
  }
}

/**
 * One-line title for a span: the HTTP method, host, and path for a request
 * span (`GET api.example.com/users`), else the span name.
 */
export function formatSpanTitle(span: AppObserveSpan): string {
  const host = span.http?.urlHost;
  if (!host) {
    return span.name;
  }
  const path = span.http?.urlFull ? formatSpanUrlPath(span.http.urlFull) : '';
  return `${span.name} ${host}${path}`;
}

export interface ObserveSpanHttpJson {
  method: string | null;
  statusCode: number | null;
  urlHost: string | null;
  urlFull: string | null;
  protocolVersion: string | null;
  requestSize: number | null;
  responseSize: number | null;
  errorType: string | null;
}

export interface ObserveSpanJson {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  startTimestamp: string;
  endTimestamp: string;
  durationMs: number;
  statusCode: string;
  statusMessage: string | null;
  sessionId: string | null;
  http: ObserveSpanHttpJson | null;
  attributes: Array<{ key: string; value: string; type: string }>;
  events: Array<{ name: string; timestamp: string; attributes: unknown }>;
  droppedAttributesCount: number;
  droppedEventsCount: number;
  droppedLinksCount: number;
  ingestedAt: string | null;
  appVersion: string;
  appBuildNumber: string;
  appUpdateId: string | null;
  appEasBuildId: string | null;
  expoSdkVersion: string | null;
  reactNativeVersion: string | null;
  deviceModel: string;
  deviceOs: string;
  deviceOsVersion: string;
  environment: string | null;
  easClientId: string;
  countryCode: string | null;
}

export function buildObserveSpanJson(span: AppObserveSpan): ObserveSpanJson {
  return {
    id: span.id,
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? null,
    name: span.name,
    kind: span.kind,
    startTimestamp: span.startTimestamp,
    endTimestamp: span.endTimestamp,
    durationMs: span.durationMs,
    statusCode: span.statusCode,
    statusMessage: span.statusMessage ?? null,
    sessionId: span.sessionId ?? null,
    http: span.http
      ? {
          method: span.http.method ?? null,
          statusCode: span.http.statusCode ?? null,
          urlHost: span.http.urlHost ?? null,
          urlFull: span.http.urlFull ?? null,
          protocolVersion: span.http.protocolVersion ?? null,
          requestSize: span.http.requestSize ?? null,
          responseSize: span.http.responseSize ?? null,
          errorType: span.http.errorType ?? null,
        }
      : null,
    attributes: span.attributes.map(a => ({ key: a.key, value: a.value, type: a.type })),
    events: span.events.map(e => ({
      name: e.name,
      timestamp: e.timestamp,
      attributes: e.attributes,
    })),
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    ingestedAt: span.ingestedAt ?? null,
    appVersion: span.appVersion,
    appBuildNumber: span.appBuildNumber,
    appUpdateId: span.appUpdateId ?? null,
    appEasBuildId: span.appEasBuildId ?? null,
    expoSdkVersion: span.expoSdkVersion ?? null,
    reactNativeVersion: span.reactNativeVersion ?? null,
    deviceModel: span.deviceModel,
    deviceOs: span.deviceOs,
    deviceOsVersion: span.deviceOsVersion,
    environment: span.environment ?? null,
    easClientId: span.easClientId,
    countryCode: span.countryCode ?? null,
  };
}

export interface BuildSpanNamesTableOptions {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  isTruncated?: boolean;
}

export function buildObserveSpanNamesTable(
  names: AppObserveSpanName[],
  options?: BuildSpanNamesTableOptions
): string {
  if (names.length === 0) {
    return chalk.yellow('No spans found.');
  }

  const headers = ['Span Name', 'Kind', 'Count'];
  const rows: string[][] = names.map(n => [
    sanitizeTerminalText(n.name),
    n.kind,
    n.count.toLocaleString(),
  ]);

  const lines: string[] = [];

  if (options) {
    const timeDesc = buildTimeRangeDescription(options);
    lines.push(chalk.bold(`Span names ${timeDesc}`.trim()), '');
  }

  lines.push(renderTextTable(headers, rows));

  if (options?.isTruncated) {
    lines.push('', chalk.yellow('Result is truncated; not all span names are shown.'));
  }

  lines.push(
    '',
    'Pass --all-spans or a span filter such as --name, --host, or --status to list individual spans.'
  );

  return lines.join('\n');
}

export function buildObserveSpanNamesJson(
  names: AppObserveSpanName[],
  isTruncated: boolean
): { names: Array<{ name: string; kind: string; count: number }>; isTruncated: boolean } {
  return {
    names: names.map(n => ({ name: n.name, kind: n.kind, count: n.count })),
    isTruncated,
  };
}

export interface BuildSpansTableOptions {
  daysBack?: number;
  startTime?: string;
  endTime?: string;
  sessionId?: string;
}

export function buildObserveSpansTable(
  spans: AppObserveSpan[],
  pageInfo: PageInfo,
  options?: BuildSpansTableOptions
): string {
  if (spans.length === 0) {
    return chalk.yellow('No spans found.');
  }

  const headers = [
    'Timestamp',
    'Name',
    'Duration',
    'Status',
    'HTTP',
    'Host',
    'App Version',
    'Platform',
    'Trace ID',
  ];

  const rows: string[][] = spans.map(span => [
    formatLogTimestamp(span.startTimestamp),
    sanitizeTerminalText(span.name),
    formatSpanDuration(span.durationMs),
    span.statusCode,
    formatSpanHttpStatus(span),
    sanitizeTerminalText(span.http?.urlHost ?? '-'),
    `${span.appVersion} (${span.appBuildNumber})`,
    `${span.deviceOs} ${span.deviceOsVersion}`,
    span.traceId,
  ]);

  const lines: string[] = [];

  if (options) {
    const subject = options.sessionId ? `Spans in session ${options.sessionId}` : 'Spans';
    const timeDesc = options.sessionId ? '' : buildTimeRangeDescription(options);
    lines.push(chalk.bold(`${subject} ${timeDesc}`.trim()), '');
  }

  lines.push(renderTextTable(headers, rows));

  lines.push('', 'Show a whole trace: eas observe:trace <Trace ID>');

  if (pageInfo.hasNextPage && pageInfo.endCursor) {
    lines.push('', `Next page: --after ${pageInfo.endCursor}`);
  }

  return lines.join('\n');
}

export function buildObserveSpansJson(
  spans: AppObserveSpan[],
  pageInfo: PageInfo
): {
  spans: ObserveSpanJson[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
} {
  return {
    spans: spans.map(buildObserveSpanJson),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage,
      endCursor: pageInfo.endCursor ?? null,
    },
  };
}

export interface TraceTreeRow {
  span: AppObserveSpan;
  depth: number;
}

function compareByStart(a: AppObserveSpan, b: AppObserveSpan): number {
  if (a.startTimestamp !== b.startTimestamp) {
    return a.startTimestamp < b.startTimestamp ? -1 : 1;
  }
  return a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0;
}

/**
 * Orders a trace's spans depth-first, children under their parent, siblings
 * oldest first. A span whose parent is not in the trace is shown as a root.
 */
export function orderTraceSpans(spans: AppObserveSpan[]): TraceTreeRow[] {
  const spanIds = new Set(spans.map(span => span.spanId));
  const childrenByParent = new Map<string | null, AppObserveSpan[]>();
  for (const span of spans) {
    const parentKey =
      span.parentSpanId && spanIds.has(span.parentSpanId) ? span.parentSpanId : null;
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(span);
    childrenByParent.set(parentKey, siblings);
  }

  const rows: TraceTreeRow[] = [];
  const visit = (parentKey: string | null, depth: number): void => {
    const children = childrenByParent.get(parentKey) ?? [];
    for (const span of [...children].sort(compareByStart)) {
      rows.push({ span, depth });
      visit(span.spanId, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

export function buildObserveTraceTable(trace: AppObserveTrace): string {
  const rows = orderTraceSpans(trace.spans);
  const lines: string[] = [chalk.bold(`Trace ${trace.id}`), ''];

  if (rows.length === 0) {
    lines.push(chalk.yellow('No spans found for this trace.'));
    return lines.join('\n');
  }

  const sessionId = trace.spans.find(span => span.sessionId)?.sessionId;
  const first = rows[0].span;
  lines.push(
    `Started:     ${formatLogTimestamp(first.startTimestamp)}`,
    `Spans:       ${rows.length}${trace.isTruncated ? ' (truncated)' : ''}`,
    `App version: ${first.appVersion} (${first.appBuildNumber})`,
    `Device:      ${sanitizeTerminalText(first.deviceModel)} · ${first.deviceOs} ${first.deviceOsVersion}`,
    `Session:     ${sessionId ?? '-'}`,
    ''
  );

  const traceStartMs = Math.min(
    ...trace.spans.map(span => new Date(span.startTimestamp).getTime())
  );
  const headers = ['Offset', 'Duration', 'Name', 'Status', 'HTTP', 'URL'];
  const tableRows: string[][] = rows.map(({ span, depth }) => [
    formatSpanDuration(new Date(span.startTimestamp).getTime() - traceStartMs),
    formatSpanDuration(span.durationMs),
    `${'  '.repeat(depth)}${sanitizeTerminalText(span.name)}`,
    span.statusCode,
    formatSpanHttpStatus(span),
    sanitizeTerminalText(span.http?.urlFull ?? '-'),
  ]);
  lines.push(renderTextTable(headers, tableRows));

  if (trace.isTruncated) {
    lines.push('', chalk.yellow('This trace has more spans than are shown.'));
  }

  if (sessionId) {
    lines.push('', `Show the session timeline: eas observe:session ${sessionId}`);
  }

  return lines.join('\n');
}

export function buildObserveTraceJson(trace: AppObserveTrace): {
  id: string;
  isTruncated: boolean;
  spans: ObserveSpanJson[];
} {
  return {
    id: trace.id,
    isTruncated: trace.isTruncated,
    spans: orderTraceSpans(trace.spans).map(({ span }) => buildObserveSpanJson(span)),
  };
}
