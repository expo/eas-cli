import { AppObserveCustomEvent, PageInfo } from '../../graphql/generated';
import {
  buildObserveCustomEventNamesTable,
  buildObserveCustomEventsEmptyWithSuggestionsJson,
  buildObserveCustomEventsEmptyWithSuggestionsTable,
  buildObserveCustomEventsJson,
  buildObserveCustomEventsTable,
} from '../formatCustomEvents';

function makeCustomEvent(overrides: Partial<AppObserveCustomEvent> = {}): AppObserveCustomEvent {
  return {
    __typename: 'AppObserveCustomEvent' as const,
    id: 'evt-1',
    eventName: 'my_event',
    timestamp: '2025-01-15T10:30:00.000Z',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    easClientId: 'client-1',
    properties: [],
    ...overrides,
  } as AppObserveCustomEvent;
}

const noNextPage: PageInfo = { hasNextPage: false, hasPreviousPage: false };
const withNextPage: PageInfo = {
  hasNextPage: true,
  hasPreviousPage: false,
  endCursor: 'cursor-abc',
};

describe(buildObserveCustomEventsTable, () => {
  it('formats events into aligned columns', () => {
    const events = [
      makeCustomEvent({
        eventName: 'login',
        appVersion: '1.2.0',
        appBuildNumber: '42',
        deviceOs: 'iOS',
        deviceOsVersion: '17.0',
        deviceModel: 'iPhone 15',
        countryCode: 'US',
        timestamp: '2025-01-15T10:30:00.000Z',
      }),
      makeCustomEvent({
        id: 'evt-2',
        eventName: 'checkout',
        appVersion: '1.1.0',
        appBuildNumber: '38',
        deviceOs: 'Android',
        deviceOsVersion: '14',
        deviceModel: 'Pixel 8',
        countryCode: 'PL',
        timestamp: '2025-01-14T08:15:00.000Z',
      }),
    ];

    const output = buildObserveCustomEventsTable(events, noNextPage);

    expect(output).toMatchInlineSnapshot(`
"[1mTimestamp                      Event     App Version  Platform    Device     Country[22m
-----------------------------  --------  -----------  ----------  ---------  -------
Jan 15, 2025, 10:30:00.000 AM  login     1.2.0 (42)   iOS 17.0    iPhone 15  US     
Jan 14, 2025, 08:15:00.000 AM  checkout  1.1.0 (38)   Android 14  Pixel 8    PL     "
`);
  });

  it('returns yellow warning for empty events', () => {
    const output = buildObserveCustomEventsTable([], noNextPage);
    expect(output).toContain('No custom events found.');
  });

  it('shows event name in summary header when an event name option is provided', () => {
    const events = [makeCustomEvent({ eventName: 'login' })];
    const output = buildObserveCustomEventsTable(events, noNextPage, {
      eventName: 'login',
      daysBack: 30,
    });

    expect(output).toContain('login events for the last 30 days');
  });

  it('shows the generic "Custom events" subject when no event name option is provided', () => {
    const events = [makeCustomEvent()];
    const output = buildObserveCustomEventsTable(events, noNextPage, {
      daysBack: 30,
    });

    expect(output).toContain('Custom events for the last 30 days');
  });

  it('shows date range in summary header when start/end provided', () => {
    const events = [makeCustomEvent()];
    const output = buildObserveCustomEventsTable(events, noNextPage, {
      eventName: 'login',
      startTime: '2025-01-01T00:00:00.000Z',
      endTime: '2025-02-01T00:00:00.000Z',
    });

    expect(output).toContain('login events from Jan 1, 2025 to Feb 1, 2025');
  });

  it('appends total event count to summary header when provided', () => {
    const events = [makeCustomEvent()];
    const output = buildObserveCustomEventsTable(events, noNextPage, {
      eventName: 'login',
      daysBack: 7,
      totalEventCount: 1234,
    });

    expect(output).toContain('login events for the last 7 days — 1,234 total events');
  });

  it('shows - for null countryCode', () => {
    const events = [makeCustomEvent({ countryCode: null })];
    const output = buildObserveCustomEventsTable(events, noNextPage);

    const lines = output.split('\n');
    const dataLine = lines[2]; // header, separator, first data row
    expect(dataLine).toContain('-');
  });

  it('appends next page hint when hasNextPage is true', () => {
    const events = [makeCustomEvent()];
    const output = buildObserveCustomEventsTable(events, withNextPage);

    expect(output).toContain('Next page: --after cursor-abc');
  });

  it('does not append next page hint when hasNextPage is false', () => {
    const events = [makeCustomEvent()];
    const output = buildObserveCustomEventsTable(events, noNextPage);

    expect(output).not.toContain('Next page');
  });

  it('omits the Event column when an event name option is provided (single-event view)', () => {
    const events = [makeCustomEvent({ eventName: 'login' })];
    const output = buildObserveCustomEventsTable(events, noNextPage, {
      eventName: 'login',
    });

    // The summary header still mentions "login events" but the table should
    // not have an "Event" column header.
    const headerLine = output.split('\n').find(line => line.includes('Timestamp'));
    expect(headerLine).not.toContain('Event ');
  });

  it('shows the Severity column when at least one event has severityText', () => {
    const events = [makeCustomEvent({ severityText: 'INFO' }), makeCustomEvent({ id: 'evt-2' })];
    const output = buildObserveCustomEventsTable(events, noNextPage);

    expect(output).toContain('Severity');
    expect(output).toContain('INFO');
  });

  it('shows the Severity column with the number as fallback when only severityNumber is set', () => {
    const events = [makeCustomEvent({ severityNumber: 9 })];
    const output = buildObserveCustomEventsTable(events, noNextPage);

    expect(output).toContain('Severity');
    expect(output).toContain('9');
  });

  it('hides the Severity column when no event has any severity data', () => {
    const events = [makeCustomEvent()];
    const output = buildObserveCustomEventsTable(events, noNextPage);

    expect(output).not.toContain('Severity');
  });

  it('prefers severityText when both severityText and severityNumber are set', () => {
    const events = [makeCustomEvent({ severityText: 'WARN', severityNumber: 13 })];
    const output = buildObserveCustomEventsTable(events, noNextPage);

    expect(output).toContain('WARN');
    // The number alone should not appear when text is present.
    expect(output).not.toMatch(/\b13\b/);
  });

  it('falls back to "-" for events that have no severity but the column is visible', () => {
    const events = [makeCustomEvent({ severityText: 'INFO' }), makeCustomEvent({ id: 'evt-2' })];
    const output = buildObserveCustomEventsTable(events, noNextPage);

    // The second row's severity cell is "-".
    const lines = output.split('\n');
    // header + separator + 2 data rows
    expect(lines[3]).toMatch(/-/);
  });
});

describe(buildObserveCustomEventsJson, () => {
  it('preserves both severityText and severityNumber in the JSON output', () => {
    const events = [makeCustomEvent({ severityText: 'INFO', severityNumber: 9 })];
    const result = buildObserveCustomEventsJson(events, noNextPage);

    expect(result.events[0].severityText).toBe('INFO');
    expect(result.events[0].severityNumber).toBe(9);
  });

  it('returns null severity fields when not set', () => {
    const events = [makeCustomEvent()];
    const result = buildObserveCustomEventsJson(events, noNextPage);

    expect(result.events[0].severityText).toBeNull();
    expect(result.events[0].severityNumber).toBeNull();
  });

  it('maps event to JSON shape with all relevant fields and pageInfo', () => {
    const events = [
      makeCustomEvent({
        id: 'evt-1',
        eventName: 'login',
        timestamp: '2025-01-15T10:30:00.000Z',
        sessionId: 'session-1',
        severityText: 'INFO',
        severityNumber: 9,
        appVersion: '1.0.0',
        appBuildNumber: '42',
        appUpdateId: 'update-xyz',
        appEasBuildId: 'build-abc',
        deviceModel: 'iPhone 15',
        deviceOs: 'iOS',
        deviceOsVersion: '17.0',
        countryCode: 'US',
        environment: 'production',
        easClientId: 'client-1',
        properties: [
          { __typename: 'AppObserveEventProperty', key: 'foo', value: 'bar', type: 'STRING' },
        ] as any,
      }),
    ];

    const result = buildObserveCustomEventsJson(events, withNextPage);

    expect(result).toEqual({
      events: [
        {
          id: 'evt-1',
          eventName: 'login',
          timestamp: '2025-01-15T10:30:00.000Z',
          sessionId: 'session-1',
          severityText: 'INFO',
          severityNumber: 9,
          properties: [{ key: 'foo', value: 'bar', type: 'STRING' }],
          appVersion: '1.0.0',
          appBuildNumber: '42',
          appUpdateId: 'update-xyz',
          appEasBuildId: 'build-abc',
          deviceModel: 'iPhone 15',
          deviceOs: 'iOS',
          deviceOsVersion: '17.0',
          countryCode: 'US',
          environment: 'production',
          easClientId: 'client-1',
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
      makeCustomEvent({
        countryCode: null,
        sessionId: null,
        appUpdateId: null,
        appEasBuildId: null,
        environment: null,
      }),
    ];

    const result = buildObserveCustomEventsJson(events, noNextPage);

    expect(result.events[0].countryCode).toBeNull();
    expect(result.events[0].sessionId).toBeNull();
    expect(result.events[0].appUpdateId).toBeNull();
    expect(result.events[0].appEasBuildId).toBeNull();
    expect(result.events[0].environment).toBeNull();
  });

  it('returns empty events array for empty input', () => {
    const result = buildObserveCustomEventsJson([], noNextPage);
    expect(result.events).toEqual([]);
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });
});

describe(buildObserveCustomEventNamesTable, () => {
  it('returns yellow warning when names list is empty', () => {
    const output = buildObserveCustomEventNamesTable([]);
    expect(output).toContain('No custom event names found.');
  });

  it('shows event names with counts', () => {
    const output = buildObserveCustomEventNamesTable([
      { __typename: 'AppObserveCustomEventName', eventName: 'foo', count: 10 },
      { __typename: 'AppObserveCustomEventName', eventName: 'bar', count: 5 },
    ]);
    expect(output).toContain('foo');
    expect(output).toContain('10');
    expect(output).toContain('bar');
    expect(output).toContain('5');
  });

  it('appends a truncation notice when isTruncated is true', () => {
    const output = buildObserveCustomEventNamesTable(
      [{ __typename: 'AppObserveCustomEventName', eventName: 'foo', count: 10 }],
      { isTruncated: true }
    );
    expect(output).toContain('Result is truncated');
  });
});

describe(buildObserveCustomEventsEmptyWithSuggestionsTable, () => {
  it('shows the filtered event name and the available event names', () => {
    const output = buildObserveCustomEventsEmptyWithSuggestionsTable('login', [
      { __typename: 'AppObserveCustomEventName', eventName: 'foo', count: 10 },
      { __typename: 'AppObserveCustomEventName', eventName: 'bar', count: 5 },
    ]);

    expect(output).toContain('No events found matching "login"');
    expect(output).toContain('Available event names in this time range:');
    expect(output).toContain('foo');
    expect(output).toContain('10');
    expect(output).toContain('bar');
    expect(output).toContain('5');
  });

  it('falls back to "no event names found" message when names list is also empty', () => {
    const output = buildObserveCustomEventsEmptyWithSuggestionsTable('login', []);

    expect(output).toContain('No events found matching "login"');
    expect(output).toContain('No custom event names found in this time range.');
  });

  it('appends a truncation notice when isTruncated is set', () => {
    const output = buildObserveCustomEventsEmptyWithSuggestionsTable(
      'login',
      [{ __typename: 'AppObserveCustomEventName', eventName: 'foo', count: 10 }],
      { isTruncated: true }
    );

    expect(output).toContain('Result is truncated');
  });

  it('includes the time range description in the message when provided', () => {
    const output = buildObserveCustomEventsEmptyWithSuggestionsTable(
      'login',
      [{ __typename: 'AppObserveCustomEventName', eventName: 'foo', count: 10 }],
      { daysBack: 7 }
    );

    expect(output).toContain('No events found matching "login" for the last 7 days.');
  });
});

describe(buildObserveCustomEventsEmptyWithSuggestionsJson, () => {
  it('returns the filtered event name, empty events array, and available names', () => {
    const result = buildObserveCustomEventsEmptyWithSuggestionsJson(
      'login',
      [
        { __typename: 'AppObserveCustomEventName', eventName: 'foo', count: 10 },
        { __typename: 'AppObserveCustomEventName', eventName: 'bar', count: 5 },
      ],
      false
    );

    expect(result).toEqual({
      filteredEventName: 'login',
      events: [],
      availableEventNames: [
        { eventName: 'foo', count: 10 },
        { eventName: 'bar', count: 5 },
      ],
      availableEventNamesIsTruncated: false,
    });
  });

  it('preserves the isTruncated flag', () => {
    const result = buildObserveCustomEventsEmptyWithSuggestionsJson('login', [], true);
    expect(result.availableEventNamesIsTruncated).toBe(true);
  });
});
