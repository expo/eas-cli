import fetch, { RequestError, Response } from '../../fetch';
import {
  type DeviceRunSessionEvent,
  downloadDeviceRunSessionEventsAsync,
  formatDeviceRunSessionEvent,
  parseDeviceRunSessionEvents,
  projectDeviceRunSessionEventsForDisplay,
} from '../events';

jest.mock('../../fetch', () => ({
  __esModule: true,
  ...jest.requireActual('../../fetch'),
  default: jest.fn(),
}));

describe(parseDeviceRunSessionEvents, () => {
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

describe(projectDeviceRunSessionEventsForDisplay, () => {
  it('collapses completed operations and carries duration onto the recorded interaction', () => {
    const events = [
      createEventValue({
        eventId: 'started',
        type: 'operation.started',
        operationId: 'operation-id',
        summary: 'Started press',
      }),
      createEventValue({
        eventId: 'interaction',
        ts: '2026-07-10T12:00:01.000Z',
        type: 'interaction.recorded',
        operationId: 'operation-id',
        summary: 'Tapped @e13',
      }),
      createEventValue({
        eventId: 'completed',
        ts: '2026-07-10T12:00:02.000Z',
        type: 'operation.completed',
        operationId: 'operation-id',
        outcome: 'success',
        durationMs: 123,
        summary: 'Finished press',
      }),
    ];

    expect(projectDeviceRunSessionEventsForDisplay(events)).toEqual([
      {
        ...events[1],
        durationMs: 123,
        outcome: 'success',
      },
    ]);
  });

  it('preserves completed failures and successful operations without interactions', () => {
    const successful = createEventValue({
      eventId: 'successful',
      type: 'operation.completed',
      operationId: 'successful-operation',
      outcome: 'success',
      summary: 'Found 2 devices',
    });
    const failed = createEventValue({
      eventId: 'failed',
      ts: '2026-07-10T12:00:01.000Z',
      type: 'operation.completed',
      operationId: 'failed-operation',
      outcome: 'failure',
      summary: 'Failed install: INVALID_ARGS',
    });

    expect(projectDeviceRunSessionEventsForDisplay([successful, failed])).toEqual([
      successful,
      failed,
    ]);
  });

  it('can withhold incomplete operations while following a running session', () => {
    const started = createEventValue({
      eventId: 'started',
      type: 'operation.started',
      operationId: 'operation-id',
      summary: 'Started install',
    });
    const interaction = createEventValue({
      eventId: 'interaction',
      type: 'interaction.recorded',
      operationId: 'another-operation-id',
      summary: 'Captured screenshot screenshot.png',
    });
    const standalone = createEventValue({
      eventId: 'standalone',
      type: 'control.recorded',
      summary: 'Stopping session',
    });

    expect(
      projectDeviceRunSessionEventsForDisplay([started, interaction, standalone], {
        includeIncompleteOperations: false,
      })
    ).toEqual([standalone]);
    expect(projectDeviceRunSessionEventsForDisplay([started, interaction, standalone])).toEqual([
      started,
      interaction,
      standalone,
    ]);
  });

  it('keeps matching operation IDs from different producers separate', () => {
    const agentStarted = createEventValue({
      eventId: 'agent-started',
      operationId: 'shared-operation-id',
      summary: 'Started devices',
    });
    const agentCompleted = createEventValue({
      eventId: 'agent-completed',
      type: 'operation.completed',
      operationId: 'shared-operation-id',
      outcome: 'success',
      summary: 'Found 2 devices',
    });
    const serveSimStarted = createEventValue({
      eventId: 'serve-sim-started',
      producer: 'serve-sim',
      operationId: 'shared-operation-id',
      summary: 'Started simulator activity',
    });

    expect(
      projectDeviceRunSessionEventsForDisplay([agentStarted, agentCompleted, serveSimStarted]).map(
        ({ eventId }) => eventId
      )
    ).toEqual(['agent-completed', 'serve-sim-started']);
  });
});

describe(formatDeviceRunSessionEvent, () => {
  it('formats a compact log line with the producer and duration', () => {
    expect(
      formatDeviceRunSessionEvent(
        createEventValue({
          ts: '2026-07-10T12:00:01.000Z',
          summary: 'Found 2 devices',
          durationMs: 123,
        })
      )
    ).toBe('2026-07-10T12:00:01.000Z  [agent-device] Found 2 devices (123ms)');
  });

  it('includes a screenshot filename without exposing its full path', () => {
    expect(
      formatDeviceRunSessionEvent(
        createEventValue({
          summary: 'Ran screenshot',
          data: {
            command: 'screenshot',
            path: '/tmp/private/screenshot.png',
          },
        })
      )
    ).toBe('2026-07-10T12:00:00.000Z  [agent-device] Ran screenshot screenshot.png');
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
      downloadDeviceRunSessionEventsAsync('https://example.test/events')
    ).resolves.toEqual([]);
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
