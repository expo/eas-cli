import { SessionEventEntry, SessionMetadata, SessionSummary } from '../fetchSessions';
import {
  buildObserveSessionEventsJson,
  buildObserveSessionEventsTable,
  buildObserveSessionListJson,
  buildObserveSessionListTable,
} from '../formatSessions';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: 'session-1',
    firstSeenAt: '2025-01-15T10:00:00.000Z',
    lastSeenAt: '2025-01-15T10:05:00.000Z',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    deviceModel: 'iPhone 15',
    ...overrides,
  };
}

describe(buildObserveSessionListTable, () => {
  it('shows session rows with first-seen timestamp and app version', () => {
    const output = buildObserveSessionListTable([makeSession()], { daysBack: 7 });

    expect(output).toContain('Sessions for the last 7 days');
    expect(output).toContain('session-1');
    expect(output).toContain('1.0.0 (42)');
  });

  it('omits event-count, Last seen, and Device columns in the table view', () => {
    const output = buildObserveSessionListTable([makeSession()]);

    expect(output).not.toContain('Metric events');
    expect(output).not.toContain('Log events');
    expect(output).not.toContain('Last seen');
    expect(output).not.toContain('Device');
    expect(output).not.toContain('iPhone 15');
  });

  it('includes the event name in the header when eventName option is set', () => {
    const output = buildObserveSessionListTable([makeSession()], {
      daysBack: 7,
      eventName: 'login_pressed',
    });

    expect(output).toContain('Sessions containing event "login_pressed" for the last 7 days');
  });

  it('shows a tailored empty-state message when eventName is set', () => {
    const output = buildObserveSessionListTable([], {
      daysBack: 7,
      eventName: 'login_pressed',
    });
    expect(output).toContain('No sessions containing event "login_pressed" found');
  });

  it('renders separate per-platform sections grouped by deviceOs', () => {
    const sessions = [
      makeSession({ sessionId: 'android-1', deviceOs: 'Android' }),
      makeSession({ sessionId: 'ios-1', deviceOs: 'iOS' }),
      makeSession({ sessionId: 'ios-2', deviceOs: 'iOS' }),
    ];
    const output = buildObserveSessionListTable(sessions);

    const androidIndex = output.indexOf('Android');
    const iosIndex = output.indexOf('iOS');
    expect(androidIndex).toBeGreaterThanOrEqual(0);
    expect(iosIndex).toBeGreaterThan(androidIndex);
    expect(output).toContain('android-1');
    expect(output).toContain('ios-1');
    expect(output).toContain('ios-2');
  });

  it('renders an empty-state message when no sessions are present', () => {
    const output = buildObserveSessionListTable([], {
      daysBack: 7,
      scannedMetricEventCount: 10,
      scannedLogEventCount: 20,
    });
    expect(output).toContain('No sessions found');
    expect(output).toContain('Scanned 10 metric events and 20 log events.');
  });

  it('includes a "Derived from N metric / M log events" footer', () => {
    const output = buildObserveSessionListTable([makeSession()], {
      scannedMetricEventCount: 50,
      scannedLogEventCount: 80,
    });
    expect(output).toContain('Derived from 50 metric events and 80 log events.');
  });

  it('always includes the 100-event cap note', () => {
    const output = buildObserveSessionListTable([makeSession()]);
    expect(output).toContain('scans the most recent 100 metric events and 100 log events');
  });

  it('includes the 100-event cap note on the empty-result path too', () => {
    const output = buildObserveSessionListTable([]);
    expect(output).toContain('No sessions found');
    expect(output).toContain('scans the most recent 100 metric events and 100 log events');
  });
});

describe(buildObserveSessionListJson, () => {
  it('returns a structured payload with scan counts and truncation flag', () => {
    const sessions = [makeSession()];
    const result = buildObserveSessionListJson(sessions, 10, 20, false);
    expect(result).toEqual({
      sessions,
      scannedMetricEventCount: 10,
      scannedLogEventCount: 20,
      isTruncated: false,
    });
  });
});

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
