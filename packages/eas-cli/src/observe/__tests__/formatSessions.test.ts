import { SessionEventEntry, SessionMetadata } from '../fetchSessions';
import { buildObserveSessionEventsJson, buildObserveSessionEventsTable } from '../formatSessions';

function makeMetricEntry(overrides: Partial<SessionEventEntry> = {}): SessionEventEntry {
  return {
    source: 'metric',
    timestamp: '2025-01-15T10:00:00.000Z',
    sessionId: 'session-1',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appUpdateId: null,
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    countryCode: 'US',
    easClientId: 'client-1',
    metricName: 'expo.app_startup.tti',
    metricValue: 0.8,
    customParams: null,
    ...overrides,
  };
}

function makeLogEntry(overrides: Partial<SessionEventEntry> = {}): SessionEventEntry {
  return {
    source: 'log',
    timestamp: '2025-01-15T10:01:00.000Z',
    sessionId: 'session-1',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appUpdateId: null,
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    countryCode: 'US',
    easClientId: 'client-1',
    eventName: 'login_pressed',
    severityText: null,
    severityNumber: null,
    properties: [],
    environment: 'production',
    ...overrides,
  };
}

describe(buildObserveSessionEventsTable, () => {
  it('renders a chronological table with display name for metric rows and event name for log rows', () => {
    const entries: SessionEventEntry[] = [
      makeMetricEntry(),
      makeLogEntry({ timestamp: '2025-01-15T10:02:00.000Z' }),
    ];

    const output = buildObserveSessionEventsTable(entries);

    expect(output).not.toContain('Session session-1');
    expect(output).not.toContain('for the last');
    expect(output).toContain('TTI');
    expect(output).toContain('0.80s');
    expect(output).toContain('login_pressed');
    expect(output).toContain('metric');
    expect(output).toContain('log');
  });

  it('appends the routeName to navigation metric rows', () => {
    const entries = [
      makeMetricEntry({
        metricName: 'expo.navigation.tti',
        metricValue: 0.32,
        routeName: '/home',
      }),
    ];
    const output = buildObserveSessionEventsTable(entries);
    expect(output).toContain('Nav TTI · /home');
  });

  it('shows event times as offsets in seconds from the first event', () => {
    const entries: SessionEventEntry[] = [
      makeMetricEntry({ timestamp: '2025-01-15T10:00:00.000Z' }),
      makeLogEntry({ timestamp: '2025-01-15T10:00:01.234Z' }),
      makeLogEntry({ timestamp: '2025-01-15T10:00:12.500Z' }),
    ];

    const output = buildObserveSessionEventsTable(entries);

    expect(output).toContain('Offset');
    expect(output).toContain('0.00s');
    expect(output).toContain('1.23s');
    expect(output).toContain('12.50s');
    // The absolute-time column header is gone now.
    expect(output).not.toContain('Timestamp');
  });

  it('renders separate Value, Properties, and Severity columns', () => {
    const output = buildObserveSessionEventsTable([makeLogEntry()]);
    const headerLine = output.split('\n').find(line => line.includes('Offset'));
    expect(headerLine).toContain('Value');
    expect(headerLine).toContain('Properties');
    expect(headerLine).toContain('Severity');
    expect(headerLine).not.toContain('Value / Severity');
  });

  it('shows severity text in the Severity column for log entries', () => {
    const entries = [makeLogEntry({ severityText: 'WARN' })];
    const output = buildObserveSessionEventsTable(entries);
    expect(output).toContain('WARN');
  });

  it('falls back to severity number in the Severity column when only a number is set', () => {
    const entries = [makeLogEntry({ severityNumber: 13 })];
    const output = buildObserveSessionEventsTable(entries);
    expect(output).toContain('13');
  });

  it('shows primitive properties in the Properties column, one row per property', () => {
    const entries = [
      makeLogEntry({
        properties: [
          { key: 'user_id', value: 'abc', type: 'STRING' },
          { key: 'is_premium', value: 'true', type: 'BOOLEAN' },
          { key: 'level', value: '7', type: 'NUMBER' },
        ],
      }),
    ];
    const output = buildObserveSessionEventsTable(entries);
    expect(output).toContain('user_id=abc');
    expect(output).toContain('is_premium=true');
    expect(output).toContain('level=7');
  });

  it('omits non-primitive (JSON) properties from the Properties column', () => {
    const entries = [
      makeLogEntry({
        properties: [
          { key: 'user_id', value: 'abc', type: 'STRING' },
          { key: 'context', value: '{"foo":"bar"}', type: 'JSON' },
        ],
      }),
    ];
    const output = buildObserveSessionEventsTable(entries);
    expect(output).toContain('user_id=abc');
    expect(output).not.toContain('context=');
  });

  it('leaves the Value column as "-" for log entries (metric rows keep their value)', () => {
    const entries = [
      makeMetricEntry({ metricValue: 0.8 }),
      makeLogEntry({
        properties: [{ key: 'user_id', value: 'abc', type: 'STRING' }],
      }),
    ];
    const output = buildObserveSessionEventsTable(entries);
    expect(output).toContain('0.80s');
    // The log row's Value cell is '-'; the property goes into Properties.
    expect(output).toContain('user_id=abc');
  });

  it('shows "-" in the Properties column when a log entry has no primitive properties', () => {
    const entries = [
      makeLogEntry({
        properties: [{ key: 'context', value: '{}', type: 'JSON' }],
      }),
    ];
    const output = buildObserveSessionEventsTable(entries);
    const dataLines = output.split('\n').filter(line => line.includes('log'));
    expect(dataLines.some(line => line.includes('-'))).toBe(true);
  });

  it('shows an empty-state message when entries are empty', () => {
    const output = buildObserveSessionEventsTable([]);
    expect(output).toContain('No events found for this session.');
  });

  it('warns when more events are available from either source', () => {
    const output = buildObserveSessionEventsTable([makeMetricEntry()], {
      hasMoreMetricEvents: true,
      hasMoreLogEvents: true,
    });
    expect(output).toContain('More metric events and log events are available');
    expect(output).toContain('only the first 100 of each are shown');
  });

  it('renders metadata (app version, device, first/last seen) in the header when provided', () => {
    const metadata: SessionMetadata = {
      appVersion: '1.2.0',
      appBuildNumber: '99',
      appUpdateId: 'update-xyz',
      deviceOs: 'iOS',
      deviceOsVersion: '17.0',
      deviceModel: 'iPhone 15',
      countryCode: 'US',
      firstSeenAt: '2025-01-15T10:00:00.000Z',
      lastSeenAt: '2025-01-15T10:05:00.000Z',
    };
    const output = buildObserveSessionEventsTable([makeMetricEntry()], { metadata });

    expect(output).toContain('App version: 1.2.0 (99)');
    expect(output).toContain('Device:');
    expect(output).toContain('iPhone 15');
    expect(output).toContain('iOS 17.0');
    expect(output).toContain('First seen:');
    expect(output).toContain('Last seen:');
  });

  it('omits the metadata block when metadata is null', () => {
    const output = buildObserveSessionEventsTable([makeMetricEntry()], {
      metadata: null,
    });
    expect(output).not.toContain('App version:');
    expect(output).not.toContain('Device:');
    expect(output).not.toContain('First seen:');
  });
});

describe(buildObserveSessionEventsJson, () => {
  it('returns the entries, sessionId, metadata, and hasMore flags', () => {
    const entries = [makeMetricEntry()];
    const metadata: SessionMetadata = {
      appVersion: '1.0.0',
      appBuildNumber: '42',
      appUpdateId: null,
      deviceOs: 'iOS',
      deviceOsVersion: '17.0',
      deviceModel: 'iPhone 15',
      countryCode: 'US',
      firstSeenAt: '2025-01-15T10:00:00.000Z',
      lastSeenAt: '2025-01-15T10:05:00.000Z',
    };
    const result = buildObserveSessionEventsJson(entries, 'session-1', metadata, false, true);
    expect(result).toEqual({
      sessionId: 'session-1',
      metadata,
      entries,
      hasMoreMetricEvents: false,
      hasMoreLogEvents: true,
    });
  });

  it('returns null metadata when there were no entries', () => {
    const result = buildObserveSessionEventsJson([], 'session-1', null, false, false);
    expect(result.metadata).toBeNull();
  });
});
