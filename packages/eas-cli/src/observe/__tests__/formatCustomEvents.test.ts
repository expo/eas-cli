import { AppObserveCustomEvent, PageInfo } from '../../graphql/generated';
import {
  buildObserveCustomEventNamesTable,
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

describe(buildObserveCustomEventsTable, () => {
  it('returns yellow warning for empty events', () => {
    const output = buildObserveCustomEventsTable([], noNextPage);
    expect(output).toContain('No custom events found.');
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
