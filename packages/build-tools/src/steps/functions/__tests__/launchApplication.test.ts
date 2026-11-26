import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { spawnSync } from 'node:child_process';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { createLaunchApplicationFunction, launchApplicationAsync } from '../launchApplication';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

describe(launchApplicationAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
  });

  it('launches an iOS Simulator application by bundle identifier', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'launch', 'booted', 'com.example.app'],
      { env: {}, logger }
    );
  });

  it('passes launch arguments and opens a URL on iOS', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'host.exp.Exponent',
      launchArgs: ['--uitesting', 'true'],
      openUrl: 'exp://example.test',
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'xcrun',
      ['simctl', 'launch', 'booted', 'host.exp.Exponent', '--uitesting', 'true'],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'xcrun',
      [
        'simctl',
        'spawn',
        'booted',
        'defaults',
        'write',
        'com.apple.launchservices.schemeapproval',
        'com.apple.CoreSimulator.CoreSimulatorBridge-->exp',
        '-string',
        'host.exp.Exponent',
      ],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      3,
      'xcrun',
      ['simctl', 'openurl', 'booted', 'exp://example.test'],
      { env: {}, logger }
    );
  });

  it('opens a web URL on iOS without preapproving its scheme', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      openUrl: 'https://example.test',
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'xcrun',
      ['simctl', 'launch', 'booted', 'com.example.app'],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'xcrun',
      ['simctl', 'openurl', 'booted', 'https://example.test'],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });

  it('opens a custom URL on iOS when scheme preapproval fails', async () => {
    const logger = createMockLogger();
    const approvalError = new Error('Scheme approval is unavailable.');
    mockedSpawn
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
      .mockRejectedValueOnce(approvalError);

    await launchApplicationAsync({
      applicationIdentifier: 'host.exp.Exponent',
      openUrl: 'exp://example.test',
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      3,
      'xcrun',
      ['simctl', 'openurl', 'booted', 'exp://example.test'],
      { env: {}, logger }
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: approvalError },
      'Could not preapprove the exp URL scheme for host.exp.Exponent. Opening the URL anyway; the Simulator might require manual confirmation.'
    );
  });

  it('launches an Android Emulator application by package and activity', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      activityName: 'com.example.app.MainActivity',
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      ['shell', 'am', 'start', '-n', 'com.example.app/com.example.app.MainActivity'],
      { env: {}, logger }
    );
  });

  it('passes launch arguments and opens a URL on Android', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'host.exp.exponent',
      activityName: 'host.exp.exponent.MainActivity',
      launchArgs: ['--ez', 'isTest', 'true'],
      openUrl: 'exp://example.test',
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'adb',
      [
        'shell',
        'am',
        'start',
        '--ez',
        'isTest',
        'true',
        '-n',
        'host.exp.exponent/host.exp.exponent.MainActivity',
      ],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'adb',
      ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://example.test'],
      { env: {}, logger }
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      'Launching host.exp.exponent with arguments ["--ez","isTest","true"].'
    );
  });

  it('requires an activity when launching an Android application', async () => {
    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_LAUNCH_APPLICATION_MISSING_ACTIVITY' });

    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('quotes Android launch arguments and URLs for the device shell', async () => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'dev.example.app',
      activityName: 'dev.example.app.MainActivity',
      launchArgs: ['-d', 'euxy://tempo', '--es', 'probe', 'hello world', '--es', 'quote', "it's"],
      openUrl: 'exp://example.test/path?a=1&b=2',
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'adb',
      [
        'shell',
        'am',
        'start',
        '-d',
        'euxy://tempo',
        '--es',
        'probe',
        "'hello world'",
        '--es',
        'quote',
        "'it'\\''s'",
        '-n',
        'dev.example.app/dev.example.app.MainActivity',
      ],
      { env: {}, logger }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'adb',
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        "'exp://example.test/path?a=1&b=2'",
      ],
      { env: {}, logger }
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      `Launching dev.example.app with arguments ${JSON.stringify(['-d', 'euxy://tempo', '--es', 'probe', 'hello world', '--es', 'quote', "it's"])}.`
    );
  });

  it('passes iOS launch arguments with spaces unquoted', async () => {
    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      launchArgs: ['-name', 'hello world'],
      runtimePlatform: BuildRuntimePlatform.DARWIN,
      env: {},
      logger: createMockLogger(),
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'launch', 'booted', 'com.example.app', '-name', 'hello world'],
      expect.any(Object)
    );
  });

  it('round-trips quoted Android arguments through a POSIX shell', async () => {
    const component = 'dev.example.app/dev.example.app.MainActivity$Inner';
    const launchArgs = [
      '--es',
      'text',
      'hello world',
      '--es',
      'json',
      '{"a":1,"b":2}',
      '--es',
      'shell',
      '$(printf injected) `printf injected` $HOME ; & | < >',
      '--es',
      'glob',
      '*',
      '--es',
      'home',
      '~',
      '--esa',
      'list',
      'a\\,b,c',
      '--es',
      'whitespace',
      'one\ntwo\tthree',
      '--es',
      'unicode',
      'héllo 🌍',
      '--es',
      'empty',
      '',
    ];
    const openUrl = 'exp://example.test/path?a=1&b=2#fragment';

    await launchApplicationAsync({
      applicationIdentifier: 'dev.example.app',
      activityName: 'dev.example.app.MainActivity$Inner',
      launchArgs,
      openUrl,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger: createMockLogger(),
    });

    // adb joins the words after `shell` with spaces and the device shell parses the result.
    const parsedCommands = mockedSpawn.mock.calls.map(([, args]) => {
      const { stdout } = spawnSync(
        '/bin/sh',
        ['-c', `am() { printf '%s\\0' "$@"; }; ${(args as string[]).slice(1).join(' ')}`],
        { encoding: 'utf8' }
      );
      return stdout.split('\0').slice(0, -1);
    });
    expect(parsedCommands).toEqual([
      ['start', ...launchArgs, '-n', component],
      ['start', '-a', 'android.intent.action.VIEW', '-d', openUrl],
    ]);
  });

  it.each([[['--es', 'key', '']], [['-e', 'key', '']], [['-d', '']]])(
    'passes empty Android option values as empty arguments (%j)',
    async launchArgs => {
      await launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        launchArgs,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      });

      expect(mockedSpawn).toHaveBeenCalledWith(
        'adb',
        [
          'shell',
          'am',
          'start',
          ...launchArgs.map(argument => (argument === '' ? "''" : argument)),
          '-n',
          'com.example.app/com.example.app.MainActivity',
        ],
        expect.any(Object)
      );
    }
  );

  it('rejects a trailing empty Android launch argument before spawning adb', async () => {
    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        launchArgs: ['--ez', 'isTest', 'true', ''],
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      message: expect.stringContaining('empty argument at position 4'),
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it.each([
    ['iOS-style flag', ['-EXDevMenuIsOnboardingFinished', 'YES']],
    ['bare positional argument', ['Portrait']],
    ['missing extra value', ['--es', 'key']],
    ['component option -n', ['-n', 'com.example.app/.OtherActivity']],
  ])('rejects invalid Android launch_args (%s) before spawning adb', async (_name, launchArgs) => {
    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        launchArgs,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it.each([
    [
      'Unknown option on stderr',
      {
        stderr:
          'java.lang.IllegalArgumentException: Unknown option: -E\n\tat android.content.Intent.parseCommandArgs',
        stdout: '',
      },
      'Unknown option: -E',
    ],
    [
      'IllegalArgumentException for invalid boolean on stderr',
      { stderr: 'java.lang.IllegalArgumentException: Invalid boolean value: maybe', stdout: '' },
      'Invalid boolean value: maybe',
    ],
    [
      'NumberFormatException for invalid int on stderr',
      { stderr: 'java.lang.NumberFormatException: For input string: "abc"', stdout: '' },
      'NumberFormatException',
    ],
    [
      'Invalid argument on stdout',
      { stderr: '', stdout: 'Error: Invalid argument for --ei' },
      'Invalid argument for --ei',
    ],
    [
      'Missing argument on stderr',
      { stderr: 'Error: Missing argument for --es', stdout: '' },
      'Missing argument for --es',
    ],
    [
      'unsupported --user all (activity wording) on stderr',
      { stderr: "Error: Can't start activity with user 'all'", stdout: '' },
      "Can't start activity with user 'all'",
      ['--user', 'all'],
    ],
    [
      'unsupported --user all (service wording on Android 14) on stderr',
      { stderr: "Error: Can't start service with user 'all'", stdout: '' },
      "Can't start service with user 'all'",
      ['--user', 'all'],
    ],
  ])(
    'classifies Android am start launch failure (%s) as EAS_LAUNCH_APPLICATION_INVALID_INPUT',
    async (_name, output, expectedDetail, launchArgs = ['--ez', 'isTest', 'maybe']) => {
      const launchError = Object.assign(
        new Error('adb shell am start exited with non-zero code: 255'),
        output
      );
      mockedSpawn.mockRejectedValueOnce(launchError);

      await expect(
        launchApplicationAsync({
          applicationIdentifier: 'com.example.app',
          activityName: 'com.example.app.MainActivity',
          launchArgs,
          runtimePlatform: BuildRuntimePlatform.LINUX,
          env: {},
          logger: createMockLogger(),
        })
      ).rejects.toMatchObject({
        errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        message: expect.stringContaining(expectedDetail),
        cause: launchError,
      });
    }
  );

  it('rethrows an unrelated Android launch failure unchanged', async () => {
    const launchError = Object.assign(
      new Error('adb shell am start exited with non-zero code: 1'),
      {
        stderr: 'adb: device offline',
        stdout: '',
      }
    );
    mockedSpawn.mockRejectedValueOnce(launchError);

    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        launchArgs: ['--ez', 'isTest', 'true'],
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toBe(launchError);
  });

  it('does not misclassify a missing-activity error when echoed intent data contains an exception name', async () => {
    const launchError = Object.assign(
      new Error('adb shell am start exited with non-zero code: 1'),
      {
        stdout:
          'Starting: Intent { act=com.example.IllegalArgumentException cmp=com.example.app/.MissingActivity }',
        stderr:
          'Error type 3\nError: Activity class {com.example.app/com.example.app.MissingActivity} does not exist.',
      }
    );
    mockedSpawn.mockRejectedValueOnce(launchError);

    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MissingActivity',
        launchArgs: ['-a', 'com.example.IllegalArgumentException'],
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toBe(launchError);
  });

  it.each([
    [
      'unable to resolve Intent on stderr',
      {
        stderr:
          'Starting: Intent { act=android.intent.action.VIEW dat=exp+example-app://... }\nError: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=exp+example-app://... flg=0x10000000 }',
        stdout: '',
      },
    ],
    [
      'case-insensitive unable to resolve Intent on stdout',
      {
        stderr: '',
        stdout:
          'Error: Activity not started, Unable To Resolve Intent { act=android.intent.action.VIEW }',
      },
    ],
    [
      'No Activity found to handle Intent on stderr',
      {
        stderr:
          'android.content.ActivityNotFoundException: No Activity found to handle Intent { act=android.intent.action.VIEW dat=exp+example-app://home }',
        stdout: '',
      },
    ],
  ])(
    'classifies Android open_url rejection (%s) as EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME',
    async (_name, output) => {
      const openUrlError = Object.assign(
        new Error(
          'adb shell am start -a android.intent.action.VIEW -d exp+example-app://home exited with non-zero code: 1'
        ),
        output
      );
      mockedSpawn
        .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
        .mockRejectedValueOnce(openUrlError);

      await expect(
        launchApplicationAsync({
          applicationIdentifier: 'com.example.app',
          activityName: 'com.example.app.MainActivity',
          openUrl: 'exp+example-app://home?token=example',
          runtimePlatform: BuildRuntimePlatform.LINUX,
          env: {},
          logger: createMockLogger(),
        })
      ).rejects.toMatchObject({
        errorCode: 'EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME',
        message: expect.stringContaining('"exp+example-app://"'),
        cause: openUrlError,
      });
    }
  );

  it.each([
    [
      'stderr',
      {
        stdout: 'Starting: Intent { act=android.intent.action.VIEW dat=exp+example-app://home }\n',
        stderr:
          'Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=exp+example-app://home flg=0x10000000 }\n',
        status: 0,
      },
    ],
    [
      'stdout',
      {
        stdout:
          'Starting: Intent { act=android.intent.action.VIEW dat=exp+example-app://home }\nError: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=exp+example-app://home flg=0x10000000 }\n',
        stderr: '',
        status: 0,
      },
    ],
  ])(
    'classifies Android open_url exit-0 unresolved Intent on %s as EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME',
    async (_stream, result) => {
      mockedSpawn
        .mockResolvedValueOnce({ stdout: '', stderr: '', status: 0 } as any)
        .mockResolvedValueOnce(result as any);

      await expect(
        launchApplicationAsync({
          applicationIdentifier: 'com.example.app',
          activityName: 'com.example.app.MainActivity',
          openUrl: 'exp+example-app://home',
          runtimePlatform: BuildRuntimePlatform.LINUX,
          env: {},
          logger: createMockLogger(),
        })
      ).rejects.toMatchObject({
        errorCode: 'EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME',
        message: expect.stringContaining('scheme, host, and path'),
      });
    }
  );

  it('does not misclassify a successful open_url whose echoed Starting line contains diagnostic text', async () => {
    mockedSpawn
      .mockResolvedValueOnce({ stdout: '', stderr: '', status: 0 } as any)
      .mockResolvedValueOnce({
        stdout:
          'Starting: Intent { act=android.intent.action.VIEW dat=https://example.test/unable to resolve Intent }\n',
        stderr: '',
        status: 0,
      } as any);

    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        openUrl: 'https://example.test/unable%20to%20resolve%20Intent',
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).resolves.toBeUndefined();
  });

  it('rethrows an unrelated Android open_url failure unchanged', async () => {
    const openUrlError = Object.assign(
      new Error(
        'adb shell am start -a android.intent.action.VIEW -d exp://example.test exited with non-zero code: 1'
      ),
      { stderr: 'adb: device offline', stdout: '' }
    );
    mockedSpawn
      .mockResolvedValueOnce({ stdout: '', stderr: '' } as any)
      .mockRejectedValueOnce(openUrlError);

    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        openUrl: 'exp://example.test',
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toBe(openUrlError);
  });

  it.each([
    { launchArgs: ['--es', 'key', 'a\0b'] },
    { launchArgs: [], openUrl: 'exp://example.test/a\0b' },
  ])('rejects NUL characters on Android (%j)', async ({ launchArgs, openUrl }) => {
    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        launchArgs,
        openUrl,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' });
    expect(mockedSpawn).not.toHaveBeenCalledWith(
      'adb',
      expect.arrayContaining([expect.stringContaining('\0')]),
      expect.any(Object)
    );
  });

  it('accepts an Android launch command of exactly 65,000 bytes', async () => {
    const fixedLength = 'am start --es key  -n com.example.app/com.example.app.MainActivity'.length;

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      activityName: 'com.example.app.MainActivity',
      launchArgs: ['--es', 'key', 'a'.repeat(65_000 - fixedLength)],
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger: createMockLogger(),
    });

    expect(mockedSpawn).toHaveBeenCalledTimes(1);
  });

  it('rejects an Android URL command of 65,001 bytes', async () => {
    const fixedLength = 'am start -a android.intent.action.VIEW -d exp://example.test/'.length;

    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        openUrl: `exp://example.test/${'a'.repeat(65_001 - fixedLength)}`,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects an Android launch command that is too long after quoting', async () => {
    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        launchArgs: ['--es', 'quotes', "'".repeat(20_000)],
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({ errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT' });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('launches using application metadata passed to the build step', async () => {
    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
          activity_name: 'com.example.app.MainActivity',
          launch_args: ['--ez', 'isTest', 'true'],
          open_url: 'exp://example.test',
        },
      }
    );
    await buildStep.executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      [
        'shell',
        'am',
        'start',
        '--ez',
        'isTest',
        'true',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
      expect.any(Object)
    );
    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'exp://example.test'],
      expect.any(Object)
    );
  });

  it('quotes Android launch arguments passed to the build step', async () => {
    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
          activity_name: 'com.example.app.MainActivity',
          launch_args: ['--es', 'probe', 'hello world'],
        },
      }
    );
    await buildStep.executeAsync();

    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      [
        'shell',
        'am',
        'start',
        '--es',
        'probe',
        "'hello world'",
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
      expect.any(Object)
    );
  });

  it.each([{}, ['valid', 42]])('rejects invalid launch arguments (%j)', async launchArgs => {
    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
          launch_args: launchArgs,
        },
      }
    );

    await expect(buildStep.executeAsync()).rejects.toMatchObject({
      errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      message: 'Input "launch_args" must be an array of strings.',
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL to open', async () => {
    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.DARWIN }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
          open_url: 'not a URL',
        },
      }
    );

    await expect(buildStep.executeAsync()).rejects.toMatchObject({
      errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
      message: 'Input "open_url" must be a valid URL.',
    });
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it.each(['application_identifier', 'activity_name'])(
    'reports an empty %s input as a user error',
    async inputName => {
      const launchApplication = createLaunchApplicationFunction();
      const buildStep = launchApplication.createBuildStepFromFunctionCall(
        createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX }),
        {
          callInputs: {
            application_identifier: 'com.example.app',
            activity_name: 'com.example.app.MainActivity',
            [inputName]: '',
          },
        }
      );

      await expect(buildStep.executeAsync()).rejects.toMatchObject({
        errorCode: 'EAS_LAUNCH_APPLICATION_INVALID_INPUT',
        message: `Input "${inputName}" must be a non-empty string. Pass the "${inputName}" output from eas/install_build.`,
      });
      expect(mockedSpawn).not.toHaveBeenCalled();
    }
  );
});
