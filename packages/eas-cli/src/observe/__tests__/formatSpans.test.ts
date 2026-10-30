import {
  AppObserveSpan,
  AppObserveSpanKind,
  AppObserveSpanName,
  AppObserveSpanStatusCode,
  AppObserveTrace,
  PageInfo,
} from '../../graphql/generated';
import {
  buildObserveSpanJson,
  buildObserveSpanNamesJson,
  buildObserveSpanNamesTable,
  buildObserveSpansJson,
  buildObserveSpansTable,
  buildObserveTraceJson,
  buildObserveTraceTable,
  formatSpanDuration,
  formatSpanHttpStatus,
  formatSpanTitle,
  formatSpanUrlPath,
  orderTraceSpans,
} from '../formatSpans';

const TRACE_ID = 'a'.repeat(32);

function makeSpan(overrides: Partial<AppObserveSpan> = {}): AppObserveSpan {
  return {
    __typename: 'AppObserveSpan' as const,
    id: 'span-1',
    traceId: TRACE_ID,
    spanId: '1'.repeat(16),
    parentSpanId: null,
    name: 'GET',
    kind: AppObserveSpanKind.Client,
    startTimestamp: '2025-01-15T10:00:00.000Z',
    endTimestamp: '2025-01-15T10:00:00.123Z',
    durationMs: 123.4,
    statusCode: AppObserveSpanStatusCode.Ok,
    statusMessage: null,
    sessionId: 'session-1',
    http: {
      __typename: 'AppObserveSpanHttp' as const,
      method: 'GET',
      statusCode: 200,
      urlHost: 'api.example.com',
      urlFull: 'https://api.example.com/users?page=1',
      protocolVersion: '1.1',
      requestSize: 100,
      responseSize: 2000,
      errorType: null,
    },
    attributes: [{ key: 'expo.http.resource.fetch_type', value: 'network', type: 'STRING' }],
    events: [{ name: 'exception', timestamp: '2025-01-15T10:00:00.100Z', attributes: { a: 1 } }],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 1,
    ingestedAt: '2025-01-15T10:00:05.000Z',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appUpdateId: null,
    appEasBuildId: null,
    expoSdkVersion: '54.0.0',
    reactNativeVersion: '0.81.0',
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    environment: 'production',
    easClientId: 'client-1',
    countryCode: 'US',
    ...overrides,
  } as AppObserveSpan;
}

function makeSpanName(name: string, kind: AppObserveSpanKind, count: number): AppObserveSpanName {
  return { __typename: 'AppObserveSpanName' as const, name, kind, count };
}

const noNextPage: PageInfo = { hasNextPage: false, hasPreviousPage: false };
const withNextPage: PageInfo = {
  hasNextPage: true,
  hasPreviousPage: false,
  endCursor: 'cursor-abc',
};

describe(formatSpanDuration, () => {
  it('shows milliseconds under a second and seconds above', () => {
    expect(formatSpanDuration(0.4)).toBe('0ms');
    expect(formatSpanDuration(123.4)).toBe('123ms');
    expect(formatSpanDuration(999.6)).toBe('1.00s');
    expect(formatSpanDuration(1234)).toBe('1.23s');
  });
});

describe(formatSpanHttpStatus, () => {
  it('prefers the status code, then the error type, then a dash', () => {
    expect(formatSpanHttpStatus(makeSpan())).toBe('200');
    expect(
      formatSpanHttpStatus(
        makeSpan({ http: { statusCode: null, errorType: 'NSURLErrorTimedOut' } as any })
      )
    ).toBe('NSURLErrorTimedOut');
    expect(formatSpanHttpStatus(makeSpan({ http: null }))).toBe('-');
  });
});

describe(formatSpanUrlPath, () => {
  it('keeps the path and query of a URL and returns unparsable input as is', () => {
    expect(formatSpanUrlPath('https://api.example.com/users?page=1')).toBe('/users?page=1');
    expect(formatSpanUrlPath('not a url')).toBe('not a url');
  });
});

describe(formatSpanTitle, () => {
  it('joins the span name, host, and path for a request span', () => {
    expect(formatSpanTitle(makeSpan())).toBe('GET api.example.com/users?page=1');
  });

  it('falls back to the span name for a non-HTTP span', () => {
    expect(formatSpanTitle(makeSpan({ name: 'render', http: null }))).toBe('render');
  });
});

describe(buildObserveSpanNamesTable, () => {
  it('lists names with kind and count and a hint to list spans', () => {
    const output = buildObserveSpanNamesTable(
      [
        makeSpanName('GET', AppObserveSpanKind.Client, 1234),
        makeSpanName('POST', AppObserveSpanKind.Client, 5),
      ],
      { daysBack: 7 }
    );
    expect(output).toContain('Span names for the last 7 days');
    expect(output).toContain('GET');
    expect(output).toContain('CLIENT');
    expect(output).toContain((1234).toLocaleString());
    expect(output).toContain('--all-spans');
    expect(output).not.toContain('truncated');
  });

  it('strips control characters from span names', () => {
    const output = buildObserveSpanNamesTable([
      makeSpanName('GET\u001b[2J', AppObserveSpanKind.Client, 1),
    ]);
    expect(output).not.toContain('\u001b[2J');
    expect(output).toContain('GET');
  });

  it('notes truncation', () => {
    const output = buildObserveSpanNamesTable([makeSpanName('GET', AppObserveSpanKind.Client, 1)], {
      isTruncated: true,
    });
    expect(output).toContain('truncated');
  });

  it('reports no spans', () => {
    expect(buildObserveSpanNamesTable([])).toContain('No spans found.');
  });
});

describe(buildObserveSpanNamesJson, () => {
  it('maps names and the truncation flag', () => {
    expect(
      buildObserveSpanNamesJson([makeSpanName('GET', AppObserveSpanKind.Client, 3)], true)
    ).toEqual({ names: [{ name: 'GET', kind: 'CLIENT', count: 3 }], isTruncated: true });
  });
});

describe(buildObserveSpansTable, () => {
  it('renders one row per span with duration, status, HTTP status, host, and trace id', () => {
    const output = buildObserveSpansTable([makeSpan()], noNextPage, { daysBack: 7 });
    expect(output).toContain('Spans for the last 7 days');
    const row = output.split('\n').find(line => line.includes(TRACE_ID));
    expect(row).toContain('GET');
    expect(row).toContain('123ms');
    expect(row).toContain('OK');
    expect(row).toContain('200');
    expect(row).toContain('api.example.com');
    expect(row).toContain('1.0.0 (42)');
    expect(row).toContain('iOS 17.0');
    expect(output).toContain('eas observe:trace <Trace ID>');
    expect(output).not.toContain('Next page');
  });

  it('strips control characters from span names and hosts', () => {
    const span = makeSpan({
      name: 'GET\u001b[2J',
      http: { ...makeSpan().http!, urlHost: 'api.example.com\u0007' },
    });
    const output = buildObserveSpansTable([span], noNextPage);
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('\u0007');
    expect(output).toContain('GET');
    expect(output).toContain('api.example.com');
  });

  it('titles the table by session when a session filter is set', () => {
    const output = buildObserveSpansTable([makeSpan()], noNextPage, {
      daysBack: 7,
      sessionId: 'session-1',
    });
    expect(output).toContain('Spans in session session-1');
    expect(output).not.toContain('for the last');
  });

  it('appends the next page hint when hasNextPage is true', () => {
    const output = buildObserveSpansTable([makeSpan()], withNextPage);
    expect(output).toContain('Next page: --after cursor-abc');
  });

  it('reports no spans', () => {
    expect(buildObserveSpansTable([], noNextPage)).toContain('No spans found.');
  });
});

describe(buildObserveSpanJson, () => {
  it('maps every field and nulls missing optionals', () => {
    const json = buildObserveSpanJson(makeSpan());
    expect(json).toEqual({
      id: 'span-1',
      traceId: TRACE_ID,
      spanId: '1'.repeat(16),
      parentSpanId: null,
      name: 'GET',
      kind: 'CLIENT',
      startTimestamp: '2025-01-15T10:00:00.000Z',
      endTimestamp: '2025-01-15T10:00:00.123Z',
      durationMs: 123.4,
      statusCode: 'OK',
      statusMessage: null,
      sessionId: 'session-1',
      http: {
        method: 'GET',
        statusCode: 200,
        urlHost: 'api.example.com',
        urlFull: 'https://api.example.com/users?page=1',
        protocolVersion: '1.1',
        requestSize: 100,
        responseSize: 2000,
        errorType: null,
      },
      attributes: [{ key: 'expo.http.resource.fetch_type', value: 'network', type: 'STRING' }],
      events: [{ name: 'exception', timestamp: '2025-01-15T10:00:00.100Z', attributes: { a: 1 } }],
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 1,
      ingestedAt: '2025-01-15T10:00:05.000Z',
      appVersion: '1.0.0',
      appBuildNumber: '42',
      appUpdateId: null,
      appEasBuildId: null,
      expoSdkVersion: '54.0.0',
      reactNativeVersion: '0.81.0',
      deviceModel: 'iPhone 15',
      deviceOs: 'iOS',
      deviceOsVersion: '17.0',
      environment: 'production',
      easClientId: 'client-1',
      countryCode: 'US',
    });
    expect(buildObserveSpanJson(makeSpan({ http: null })).http).toBeNull();
  });
});

describe(buildObserveSpansJson, () => {
  it('wraps spans with pageInfo', () => {
    const json = buildObserveSpansJson([makeSpan()], withNextPage);
    expect(json.spans).toHaveLength(1);
    expect(json.pageInfo).toEqual({ hasNextPage: true, endCursor: 'cursor-abc' });
  });
});

function makeTrace(spans: AppObserveSpan[], isTruncated = false): AppObserveTrace {
  return { __typename: 'AppObserveTrace' as const, id: TRACE_ID, spans, isTruncated };
}

const root = makeSpan({
  id: 'root',
  spanId: 'r'.repeat(16),
  startTimestamp: '2025-01-15T10:00:00.000Z',
});
const childLater = makeSpan({
  id: 'child-later',
  spanId: 'b'.repeat(16),
  parentSpanId: 'r'.repeat(16),
  name: 'POST',
  startTimestamp: '2025-01-15T10:00:00.500Z',
  durationMs: 50,
});
const childEarlier = makeSpan({
  id: 'child-earlier',
  spanId: 'c'.repeat(16),
  parentSpanId: 'r'.repeat(16),
  startTimestamp: '2025-01-15T10:00:00.200Z',
  durationMs: 2500,
});
const grandchild = makeSpan({
  id: 'grandchild',
  spanId: 'd'.repeat(16),
  parentSpanId: 'c'.repeat(16),
  startTimestamp: '2025-01-15T10:00:00.300Z',
});
const orphan = makeSpan({
  id: 'orphan',
  spanId: 'e'.repeat(16),
  parentSpanId: 'f'.repeat(16),
  startTimestamp: '2025-01-15T10:00:00.100Z',
});

describe(orderTraceSpans, () => {
  it('walks children under their parent, siblings oldest first, orphans as roots', () => {
    const rows = orderTraceSpans([childLater, grandchild, orphan, childEarlier, root]);
    expect(rows.map(r => [r.span.id, r.depth])).toEqual([
      ['root', 0],
      ['child-earlier', 1],
      ['grandchild', 2],
      ['child-later', 1],
      ['orphan', 0],
    ]);
  });
});

describe(buildObserveTraceTable, () => {
  it('renders a header, indented rows with offsets, and a session hint', () => {
    const output = buildObserveTraceTable(makeTrace([childLater, childEarlier, root]));
    expect(output).toContain(`Trace ${TRACE_ID}`);
    expect(output).toContain('Spans:       3');
    expect(output).toContain('Session:     session-1');
    expect(output).toContain('eas observe:session session-1');

    const lines = output.split('\n');
    const rootLine = lines.find(
      line => line.includes('https://api.example.com') && line.includes('0ms')
    );
    expect(rootLine).toBeDefined();
    const indentedLines = lines.filter(
      line => /\s{2}GET|\s{2}POST/.test(line) && line.includes('ms')
    );
    expect(indentedLines.length).toBeGreaterThanOrEqual(1);
    expect(output).toContain('200ms');
    expect(output).toContain('500ms');
    expect(output).toContain('2.50s');
    expect(output).not.toContain('more spans');
  });

  it('strips control characters from the device, span names, and URLs', () => {
    const span = makeSpan({
      name: 'GET\u001b[2J',
      deviceModel: 'iPhone\u0007 15',
      http: { ...makeSpan().http!, urlFull: 'https://api.example.com/\u001b[Husers' },
    });
    const output = buildObserveTraceTable(makeTrace([span]));
    expect(output).not.toContain('\u001b[2J');
    expect(output).not.toContain('\u001b[H');
    expect(output).not.toContain('\u0007');
    expect(output).toContain('Device:      iPhone 15');
    expect(output).toContain('https://api.example.com/[Husers');
  });

  it('notes truncation', () => {
    const output = buildObserveTraceTable(makeTrace([root], true));
    expect(output).toContain('Spans:       1 (truncated)');
    expect(output).toContain('more spans');
  });

  it('handles a trace without spans', () => {
    expect(buildObserveTraceTable(makeTrace([]))).toContain('No spans found for this trace.');
  });
});

describe(buildObserveTraceJson, () => {
  it('keeps the tree order and the truncation flag', () => {
    const json = buildObserveTraceJson(makeTrace([childLater, childEarlier, root], true));
    expect(json.id).toBe(TRACE_ID);
    expect(json.isTruncated).toBe(true);
    expect(json.spans.map(s => s.id)).toEqual(['root', 'child-earlier', 'child-later']);
  });
});
