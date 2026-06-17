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

    const output = buildObserveSessionEventsTable(entries, 'session-1');

    expect(output).toContain('Session session-1');
    expect(output).not.toContain('for the last');
    expect(output).toContain('TTI');
    expect(output).toContain('0.80s');
    expect(output).toContain('login_pressed');
    expect(output).toContain('metric');
    expect(output).toContain('log');
  });

  it('shows severity text when present on a log entry', () => {
    const entries = [makeLogEntry({ severityText: 'WARN' })];
    const output = buildObserveSessionEventsTable(entries, 'session-1');
    expect(output).toContain('WARN');
  });

  it('falls back to severity number when only a number is set', () => {
    const entries = [makeLogEntry({ severityNumber: 13 })];
    const output = buildObserveSessionEventsTable(entries, 'session-1');
    expect(output).toContain('13');
  });

  it('shows an empty-state message when entries are empty', () => {
    const output = buildObserveSessionEventsTable([], 'session-1');
    expect(output).toContain('No events found for this session.');
  });

  it('warns when more events are available from either source', () => {
    const output = buildObserveSessionEventsTable([makeMetricEntry()], 'session-1', {
      hasMoreMetricEvents: true,
      hasMoreLogEvents: true,
    });
    expect(output).toContain('More metric events and log events are available');
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
    const output = buildObserveSessionEventsTable([makeMetricEntry()], 'session-1', { metadata });

    expect(output).toContain('App version: 1.2.0 (99)');
    expect(output).toContain('Device:');
    expect(output).toContain('iPhone 15');
    expect(output).toContain('iOS 17.0');
    expect(output).toContain('First seen:');
    expect(output).toContain('Last seen:');
  });

  it('omits the metadata block when metadata is null', () => {
    const output = buildObserveSessionEventsTable([makeMetricEntry()], 'session-1', {
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
