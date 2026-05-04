import { AppObserveEvent, PageInfo } from '../../graphql/generated';
import { buildObserveEventsJson, buildObserveEventsTable } from '../formatEvents';

function createMockEvent(overrides: Partial<AppObserveEvent> = {}): AppObserveEvent {
  return {
    __typename: 'AppObserveEvent',
    id: 'evt-1',
    metricName: 'expo.app_startup.tti',
    metricValue: 1.23,
    timestamp: '2025-01-15T10:30:00.000Z',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appIdentifier: 'com.example.app',
    appName: 'ExampleApp',
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    countryCode: 'US',
    sessionId: 'session-1',
    easClientId: 'client-1',
    eventBatchId: 'batch-1',
    tags: {},
    ...overrides,
  };
}

const noNextPage: PageInfo = { hasNextPage: false, hasPreviousPage: false };
const withNextPage: PageInfo = {
  hasNextPage: true,
  hasPreviousPage: false,
  endCursor: 'cursor-abc',
};

describe(buildObserveEventsTable, () => {
  it('formats events into aligned columns', () => {
    const events = [
      createMockEvent({
        metricName: 'expo.app_startup.tti',
        metricValue: 1.23,
        appVersion: '1.2.0',
        appBuildNumber: '42',
        deviceOs: 'iOS',
        deviceOsVersion: '17.0',
        deviceModel: 'iPhone 15',
        countryCode: 'US',
        timestamp: '2025-01-15T10:30:00.000Z',
      }),
      createMockEvent({
        id: 'evt-2',
        metricName: 'expo.app_startup.tti',
        metricValue: 0.85,
        appVersion: '1.1.0',
        appBuildNumber: '38',
        deviceOs: 'Android',
        deviceOsVersion: '14',
        deviceModel: 'Pixel 8',
        countryCode: 'PL',
        timestamp: '2025-01-14T08:15:00.000Z',
      }),
    ];

    const output = buildObserveEventsTable(events, noNextPage);

    // Escape codes are included, because the header is bolded.
    expect(output).toMatchInlineSnapshot(`
"[1mValue  App Version  Platform    Device     Country  Timestamp             [22m
-----  -----------  ----------  ---------  -------  ----------------------
1.23s  1.2.0 (42)   iOS 17.0    iPhone 15  US       Jan 15, 2025, 10:30 AM
0.85s  1.1.0 (38)   Android 14  Pixel 8    PL       Jan 14, 2025, 08:15 AM"
`);
  });

  it('returns yellow warning for empty array', () => {
    const output = buildObserveEventsTable([], noNextPage);
    expect(output).toContain('No events found.');
  });

  it('shows metric name in summary header when options are provided', () => {
    const events = [createMockEvent({ metricName: 'expo.app_startup.tti' })];
    const output = buildObserveEventsTable(events, noNextPage, {
      metricName: 'expo.app_startup.tti',
      daysBack: 30,
    });

    expect(output).toContain('TTI events for the last 30 days');
  });

  it('shows date range in summary header when start/end provided', () => {
    const events = [createMockEvent()];
    const output = buildObserveEventsTable(events, noNextPage, {
      metricName: 'expo.app_startup.cold_launch_time',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
    });

    expect(output).toContain('Cold Launch events from Jan 1, 2025 to Feb 1, 2025');
  });

  it('shows - for null countryCode', () => {
    const events = [createMockEvent({ countryCode: null })];
    const output = buildObserveEventsTable(events, noNextPage);

    // The country column should contain a dash
    const lines = output.split('\n');
    const dataLine = lines[2]; // header, separator, first data row
    expect(dataLine).toContain('-');
  });

  it('appends next page hint when hasNextPage is true', () => {
    const events = [createMockEvent()];
    const output = buildObserveEventsTable(events, withNextPage);

    expect(output).toContain('Next page: --after cursor-abc');
  });

  it('does not append next page hint when hasNextPage is false', () => {
    const events = [createMockEvent()];
    const output = buildObserveEventsTable(events, noNextPage);

    expect(output).not.toContain('Next page');
  });
});

describe(buildObserveEventsJson, () => {
  it('maps event to JSON shape with all relevant fields and pageInfo', () => {
    const events = [
      createMockEvent({
        id: 'evt-1',
        metricName: 'expo.app_startup.tti',
        metricValue: 1.23,
        appVersion: '1.0.0',
        appBuildNumber: '42',
        deviceModel: 'iPhone 15',
        deviceOs: 'iOS',
        deviceOsVersion: '17.0',
        countryCode: 'US',
        sessionId: 'session-1',
        easClientId: 'client-1',
        timestamp: '2025-01-15T10:30:00.000Z',
      }),
    ];

    const result = buildObserveEventsJson(events, withNextPage);

    expect(result).toEqual({
      events: [
        {
          id: 'evt-1',
          metricName: 'expo.app_startup.tti',
          metricValue: 1.23,
          appVersion: '1.0.0',
          appBuildNumber: '42',
          appUpdateId: null,
          deviceModel: 'iPhone 15',
          deviceOs: 'iOS',
          deviceOsVersion: '17.0',
          countryCode: 'US',
          sessionId: 'session-1',
          easClientId: 'client-1',
          timestamp: '2025-01-15T10:30:00.000Z',
          customParams: null,
        },
      ],
      pageInfo: {
        hasNextPage: true,
        endCursor: 'cursor-abc',
      },
    });
  });

  it('handles null optional fields', () => {
    const events = [
      createMockEvent({
        countryCode: null,
        sessionId: null,
      }),
    ];

    const result = buildObserveEventsJson(events, noNextPage);

    expect(result.events[0].countryCode).toBeNull();
    expect(result.events[0].sessionId).toBeNull();
  });

  it('returns empty events array for empty input', () => {
    const result = buildObserveEventsJson([], noNextPage);
    expect(result.events).toEqual([]);
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });
});
