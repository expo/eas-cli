import fetch, { RequestError, Response } from '../../fetch';
import { downloadDeviceRunSessionEventsAsync, parseDeviceRunSessionEvents } from '../events';

jest.mock('../../fetch', () => ({
  __esModule: true,
  ...jest.requireActual('../../fetch'),
  default: jest.fn(),
}));

describe(parseDeviceRunSessionEvents, () => {
  it('parses, deduplicates, and sorts events from the dedicated event log', () => {
    const first = createEvent({
      eventId: 'first',
      occurredAt: '2026-07-10T12:00:00.000Z',
    });
    const second = createEvent({
      eventId: 'second',
      occurredAt: '2026-07-10T12:00:01.000Z',
    });

    expect(
      parseDeviceRunSessionEvents(`${second}\nplain text\n${first}\n${second}`, 'session-id').map(
        ({ eventId }) => eventId
      )
    ).toEqual(['first', 'second']);
  });

  it('ignores malformed events and events belonging to another session', () => {
    expect(
      parseDeviceRunSessionEvents(
        `${createEvent({ deviceRunSessionId: 'another-session' })}\n${JSON.stringify({
          schemaVersion: 1,
        })}`,
        'session-id'
      )
    ).toEqual([]);
  });
});

describe(downloadDeviceRunSessionEventsAsync, () => {
  beforeEach(() => {
    jest.mocked(fetch).mockReset();
  });

  it('treats a missing event object as an empty log', async () => {
    const response = new Response('', { status: 404 });
    jest.mocked(fetch).mockRejectedValue(new RequestError('not found', response));

    await expect(
      downloadDeviceRunSessionEventsAsync('https://example.test/events', 'session-id')
    ).resolves.toEqual([]);
  });
});

function createEvent(
  overrides: Partial<{
    eventId: string;
    deviceRunSessionId: string;
    occurredAt: string;
  }> = {}
): string {
  return JSON.stringify({
    schemaVersion: 1,
    eventId: 'event-id',
    deviceRunSessionId: 'session-id',
    occurredAt: '2026-07-10T12:00:00.000Z',
    producer: 'agent-device',
    type: 'operation.started',
    summary: 'Started tap',
    ...overrides,
  });
}
