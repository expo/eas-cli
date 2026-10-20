import {
  DeviceRunSessionEvent,
  parseDeviceRunSessionEvents,
  quoteAndroidShellCommand,
  validateAndroidLaunchOptions,
} from '../deviceRunSession';

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

describe(quoteAndroidShellCommand, () => {
  it('quotes only arguments the device shell would split or expand', () => {
    expect(
      quoteAndroidShellCommand(['am', 'start', '--es', 'text', 'hello world', "it's", '', '-n'])
    ).toEqual(['am', 'start', '--es', 'text', "'hello world'", "'it'\\''s'", "''", '-n']);
  });

  it('rejects NUL characters', () => {
    expect(() => quoteAndroidShellCommand(['am', 'start', 'a\0b'])).toThrow(
      expect.objectContaining({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' })
    );
  });
});

describe(validateAndroidLaunchOptions, () => {
  it('leaves room for the launch component', () => {
    const fixedLength = 'am start --es key  -n'.length;
    const launchArgs = (valueLength: number) => ['--es', 'key', 'a'.repeat(valueLength)];

    expect(() =>
      validateAndroidLaunchOptions({ launchArgs: launchArgs(65_000 - 512 - fixedLength) })
    ).not.toThrow();
    expect(() =>
      validateAndroidLaunchOptions({ launchArgs: launchArgs(65_000 - 512 - fixedLength + 1) })
    ).toThrow(expect.objectContaining({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' }));
  });

  it('checks the URL to open', () => {
    expect(() => validateAndroidLaunchOptions({ openUrl: 'exp://example.test/a\0b' })).toThrow(
      expect.objectContaining({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' })
    );
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
