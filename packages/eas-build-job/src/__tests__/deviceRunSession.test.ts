import { DeviceRunSessionEvent, parseDeviceRunSessionEvents } from '../deviceRunSession';

describe('parseDeviceRunSessionEvents', () => {
  it('parses, deduplicates, and sorts events from the dedicated event log', () => {
    const first = createEvent({
      eventId: 'first',
      ts: '2026-07-10T12:00:00.000Z',
    });
    const second = createEvent({
      eventId: 'second',
      ts: '2026-07-10T12:00:01.000Z',
    });

    expect(
      parseDeviceRunSessionEvents(`${second}\nplain text\n${first}\n${second}`).map(
        ({ eventId }) => eventId
      )
    ).toEqual(['first', 'second']);
  });

  it('ignores malformed events', () => {
    expect(parseDeviceRunSessionEvents(`plain text\n${JSON.stringify({ v: 1 })}`)).toEqual([]);
  });

  it('ignores events with invalid timestamps', () => {
    expect(
      parseDeviceRunSessionEvents(
        `${createEvent({ eventId: 'invalid', ts: 'not-a-date' })}\n${createEvent({
          eventId: 'valid',
        })}`
      ).map(({ eventId }) => eventId)
    ).toEqual(['valid']);
  });
});

function createEvent(overrides: Partial<DeviceRunSessionEvent> = {}): string {
  return JSON.stringify(createEventValue(overrides));
}

function createEventValue(overrides: Partial<DeviceRunSessionEvent> = {}): DeviceRunSessionEvent {
  return {
    v: 1,
    eventId: 'event-id',
    ts: '2026-07-10T12:00:00.000Z',
    producer: 'agent-device',
    type: 'operation.started',
    summary: 'Started tap',
    ...overrides,
  };
}
