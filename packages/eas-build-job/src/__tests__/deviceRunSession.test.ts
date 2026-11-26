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
  it('rejects only commands that are too long without the launch component', () => {
    const fixedLength = 'am start --es key  -n'.length;
    const launchArgs = (valueLength: number) => ['--es', 'key', 'a'.repeat(valueLength)];

    expect(() =>
      validateAndroidLaunchOptions({ launchArgs: launchArgs(65_000 - fixedLength) })
    ).not.toThrow();
    expect(() =>
      validateAndroidLaunchOptions({ launchArgs: launchArgs(65_000 - fixedLength + 1) })
    ).toThrow(expect.objectContaining({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' }));
  });

  it('counts bytes, not characters', () => {
    // "é" is two bytes in UTF-8 and is quoted, which adds two more.
    const fixedLength = "am start --es key '' -n".length;
    const launchArgs = (extraLength: number) => [
      '--es',
      'key',
      'a'.repeat(extraLength) + 'é'.repeat(32_488),
    ];

    expect(fixedLength + 1 + 2 * 32_488).toBe(65_000);
    expect(() => validateAndroidLaunchOptions({ launchArgs: launchArgs(1) })).not.toThrow();
    expect(() => validateAndroidLaunchOptions({ launchArgs: launchArgs(2) })).toThrow(
      expect.objectContaining({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' })
    );
  });

  it('checks the URL to open', () => {
    expect(() => validateAndroidLaunchOptions({ openUrl: 'exp://example.test/a\0b' })).toThrow(
      expect.objectContaining({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' })
    );
  });

  it.each([
    ['empty launchArgs', []],
    ['boolean extra', ['--ez', 'isTest', 'true']],
    ['string extra with empty value', ['--es', 'key', '']],
    ['short string extra with empty value', ['-e', 'key', '']],
    ['string extra value starting with dash', ['--es', 'key', '-value-starting-with-dash']],
    ['string extra value looking like option', ['--es', 'key', '--not-an-option']],
    ['negative integer extra', ['--ei', 'delta', '-42']],
    ['null extra', ['--esn', 'clearedKey']],
    [
      'all intent extra types',
      [
        '-e',
        's1',
        'v1',
        '--es',
        's2',
        'v2',
        '--esn',
        'nullKey',
        '--ez',
        'b',
        'false',
        '--ei',
        'i',
        '1',
        '--el',
        'l',
        '10000000000',
        '--ef',
        'f',
        '1.5',
        '--ed',
        'd',
        '2.5',
        '--eu',
        'u',
        'https://example.test',
        '--ecn',
        'cn',
        'com.example/.OtherActivity',
        '--eia',
        'ia',
        '1,2,3',
        '--eial',
        'ial',
        '1,2',
        '--ela',
        'la',
        '10,20',
        '--elal',
        'lal',
        '10,20',
        '--efa',
        'fa',
        '1.5,2.5',
        '--efal',
        'fal',
        '1.5,2.5',
        '--eda',
        'da',
        '1.25,2.75',
        '--edal',
        'dal',
        '1.25,2.75',
        '--esa',
        'sa',
        'a,b',
        '--esal',
        'sal',
        'a,b',
      ],
    ],
    [
      'action, data, type, category, package, flags, and identifier',
      [
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'myapp://path',
        '-t',
        'text/plain',
        '-c',
        'android.intent.category.DEFAULT',
        '-p',
        'com.example.app',
        '-f',
        '0x10000000',
        '-i',
        'launch-1',
      ],
    ],
    [
      'selector launch without base package',
      ['-a', 'android.intent.action.MAIN', '--selector', '-a', 'android.intent.action.VIEW'],
    ],
    [
      'zero-arity intent and activity flags',
      [
        '--grant-read-uri-permission',
        '--grant-write-uri-permission',
        '--grant-persistable-uri-permission',
        '--grant-prefix-uri-permission',
        '--include-stopped-packages',
        '--exclude-stopped-packages',
        '--debug-log-resolution',
        '--activity-clear-top',
        '--activity-single-top',
        '--activity-clear-task',
        '--activity-no-animation',
        '--receiver-foreground',
        '--receiver-registered-only',
      ],
    ],
    [
      'am start shell options',
      [
        '-W',
        '-S',
        '-D',
        '-N',
        '-R',
        '2',
        '--user',
        '0',
        '--windowingMode',
        '1',
        '--activityType',
        '1',
        '--display',
        '0',
        '--task',
        '42',
        '--task-overlay',
        '--allow-background-activity-starts',
        '--allow-fgs-start-reason',
        '300',
        '--splashscreen-show-icon',
        '--dismiss-keyguard',
        '--dismiss-keyguard-if-insecure',
        '--suspend',
        '--async',
      ],
    ],
  ])('accepts valid Android am start arguments: %s', (_name, launchArgs) => {
    expect(() => validateAndroidLaunchOptions({ launchArgs })).not.toThrow();
  });

  it.each([
    ['iOS EXDevMenu flag', ['-EXDevMenuIsOnboardingFinished', 'YES']],
    [
      'multiple iOS EXDevMenu flags',
      [
        '-EXDevMenuIsOnboardingFinished',
        'YES',
        '-EXDevMenuShowsAtLaunch',
        'NO',
        '-EXDevMenuShowFloatingActionButton',
        'NO',
      ],
    ],
    ['iOS EXDevMenu numeric flag', ['-EXDevMenuShowFloatingActionButton', '0']],
    ['iOS custom patient flag', ['-qaOnboardedPatientId', 'test-patient-123']],
    [
      'iOS custom tenant/stage flags',
      ['-tenantIdentifier', 'example-tenant', '-stage', 'dev', '-apiStage', 'dev'],
    ],
    ['iOS tourSet flag', ['-tourSet', 'home']],
    ['iOS env flag colliding with -e prefix', ['-env', 'staging']],
    ['bare positional argument', ['Portrait']],
    ['bare positional argument after valid extra', ['--ez', 'isTest', 'true', 'Portrait']],
    ['empty option token', ['']],
    ['trailing empty option token', ['--ez', 'isTest', 'true', '']],
    ['single dash token', ['-']],
    ['double dash end-of-options token', ['--', '--es', 'key', 'value']],
    ['clustered short flags', ['-WS']],
    ['short option with attached action value', ['-aandroid.intent.action.VIEW']],
    ['short option with attached extra key', ['-ekey', 'value']],
    ['short option with attached repeat count', ['-R2']],
    ['removed legacy --opengl-trace flag', ['--opengl-trace']],
    ['unknown long option', ['--unknown-flag', 'value']],
    ['component option -n with value', ['-n', 'com.example.app/.MainActivity']],
    ['component option -n with attached value', ['-ncom.example.app/.MainActivity']],
    ['component option -n without value', ['-n']],
    ['selector following base -p package', ['-p', 'com.example.app', '--selector']],
    ['missing value for 1-arg option -a', ['-a']],
    ['missing value for 1-arg option -d', ['-d']],
    ['missing value for 1-arg option --esn', ['--esn']],
    ['missing value for 1-arg option --user', ['--user']],
    ['missing value for 1-arg option --allow-fgs-start-reason', ['--allow-fgs-start-reason']],
    ['missing value for 1-arg option -R', ['-R']],
    ['missing both arguments for 2-arg option --es', ['--es']],
    ['missing value for 2-arg option --es', ['--es', 'key']],
    ['missing value for 2-arg option --ed', ['--ed', 'weight']],
    ['missing value for 2-arg option -e', ['-e', 'key']],
    ['missing value for 2-arg option --ez', ['--ez', 'isTest']],
    ['missing value after valid option', ['-W', '--ei', 'count']],
  ])('rejects invalid Android launch_args: %s', (_name, launchArgs) => {
    expect(() => validateAndroidLaunchOptions({ launchArgs })).toThrow(
      expect.objectContaining({
        errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      })
    );
  });

  it('explains why --selector cannot follow -p on the base intent', () => {
    expect(() =>
      validateAndroidLaunchOptions({ launchArgs: ['-p', 'com.example.app', '--selector'] })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        message: expect.stringContaining('cannot be combined with "-p"'),
      })
    );
  });

  it('explains why -n is disallowed in launch_args', () => {
    expect(() =>
      validateAndroidLaunchOptions({ launchArgs: ['-n', 'com.example.app/.MainActivity'] })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        message: expect.stringContaining('sets the launch component automatically'),
      })
    );
  });

  it('includes an am start hint when rejecting iOS-style flags', () => {
    expect(() =>
      validateAndroidLaunchOptions({ launchArgs: ['-EXDevMenuIsOnboardingFinished', 'YES'] })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        message: expect.stringContaining('--es'),
      })
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
