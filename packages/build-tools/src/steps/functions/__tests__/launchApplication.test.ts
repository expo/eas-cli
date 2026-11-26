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
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
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
        '-a',
        'android.intent.action.MAIN',
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

  it.each([
    [
      'explicit -a flag',
      ['-a', 'com.example.CUSTOM_ACTION', '--es', 'flag', '1'],
      [
        'shell',
        'am',
        'start',
        '-a',
        'com.example.CUSTOM_ACTION',
        '--es',
        'flag',
        '1',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
    ],
    [
      'attached -a value',
      ['-acom.example.CUSTOM_ACTION'],
      [
        'shell',
        'am',
        'start',
        '-acom.example.CUSTOM_ACTION',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
    ],
    [
      'attached -d value',
      ['-dexample://open'],
      [
        'shell',
        'am',
        'start',
        '-dexample://open',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
    ],
    [
      'positional URI',
      ['example://open'],
      [
        'shell',
        'am',
        'start',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        'example://open',
      ],
    ],
    [
      'positional component',
      ['com.example.app/.MainActivity'],
      [
        'shell',
        'am',
        'start',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        'com.example.app/.MainActivity',
      ],
    ],
    [
      'positional package',
      ['com.example.app'],
      [
        'shell',
        'am',
        'start',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        'com.example.app',
      ],
    ],
    [
      'selector without trailing argument',
      ['--selector', '-a', 'android.intent.action.VIEW'],
      [
        'shell',
        'am',
        'start',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        '--selector',
        '-a',
        'android.intent.action.VIEW',
      ],
    ],
    [
      'double-dash followed by positional URI',
      ['--', 'example://open'],
      [
        'shell',
        'am',
        'start',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        '--',
        'example://open',
      ],
    ],
    [
      'options followed by positional URI',
      ['--es', 'flag', '1', 'example://open'],
      [
        'shell',
        'am',
        'start',
        '--es',
        'flag',
        '1',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        'example://open',
      ],
    ],
    [
      'zero-arg --streaming before -d',
      ['--streaming', '-d', 'example://open'],
      [
        'shell',
        'am',
        'start',
        '--streaming',
        '-d',
        'example://open',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
    ],
    [
      'wait flag followed by attached -d value',
      ['-W', '-dexample://open'],
      [
        'shell',
        'am',
        'start',
        '-W',
        '-dexample://open',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
    ],
    [
      'positional URI after --selector',
      ['--selector', '-a', 'android.intent.action.VIEW', 'example://open'],
      [
        'shell',
        'am',
        'start',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        '--selector',
        '-a',
        'android.intent.action.VIEW',
        'example://open',
      ],
    ],
    [
      'double-dash positional URI after --selector',
      ['--selector', '-a', 'android.intent.action.VIEW', '--', 'example://open'],
      [
        'shell',
        'am',
        'start',
        '-n',
        'com.example.app/com.example.app.MainActivity',
        '--selector',
        '-a',
        'android.intent.action.VIEW',
        '--',
        'example://open',
      ],
    ],
  ])(
    'preserves Android action/data semantics without adding MAIN for %s',
    async (_label, launchArgs, expectedArgs) => {
      const logger = createMockLogger();

      await launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        activityName: 'com.example.app.MainActivity',
        launchArgs,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger,
      });

      expect(mockedSpawn).toHaveBeenCalledWith('adb', expectedArgs, { env: {}, logger });
    }
  );

  it.each([
    ['--es values', ['--es', 'flag', '-a', '--es', 'other', '-d']],
    ['--ed key', ['--ed', '-a', '1.0']],
    ['--eda key', ['--eda', '-a', '1.0,2.0']],
    ['--edal key', ['--edal', '-d', '1.0,2.0']],
    ['attached -e key', ['-e-a', 'value']],
  ])('still adds MAIN when -a or -d is consumed by %s', async (_label, launchArgs) => {
    const logger = createMockLogger();

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      activityName: 'com.example.app.MainActivity',
      launchArgs,
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn).toHaveBeenCalledWith(
      'adb',
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        ...launchArgs,
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
      { env: {}, logger }
    );
  });

  it.each([
    [
      'leading --user',
      ['--user', '10', '--es', 'env', 'work'],
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '--user',
        '10',
        '--es',
        'env',
        'work',
        '-n',
        'com.example.app/com.example.app.WorkActivity',
      ],
    ],
    [
      'one-arg --task-display-area-feature-id before --user and -d',
      ['--task-display-area-feature-id', '1', '--user', '10', '-d', 'example://open'],
      [
        'shell',
        'am',
        'start',
        '--task-display-area-feature-id',
        '1',
        '--user',
        '10',
        '-d',
        'example://open',
        '-n',
        'com.example.app/com.example.app.WorkActivity',
      ],
    ],
    [
      'one-arg --clock-type before --user',
      ['--clock-type', 'wall', '--user', '10'],
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '--clock-type',
        'wall',
        '--user',
        '10',
        '-n',
        'com.example.app/com.example.app.WorkActivity',
      ],
    ],
    [
      'one-arg --profiler-output-version before --user',
      ['--profiler-output-version', '1', '--user', '10'],
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '--profiler-output-version',
        '1',
        '--user',
        '10',
        '-n',
        'com.example.app/com.example.app.WorkActivity',
      ],
    ],
    [
      'one-arg --allow-fgs-start-reason before --user',
      ['--allow-fgs-start-reason', '1', '--user', '10'],
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '--allow-fgs-start-reason',
        '1',
        '--user',
        '10',
        '-n',
        'com.example.app/com.example.app.WorkActivity',
      ],
    ],
  ])(
    'forwards --user from launch_args when resolving a missing Android activity (%s)',
    async (_label, launchArgs, expectedLaunchArgs) => {
      const logger = createMockLogger();
      mockedSpawn.mockResolvedValueOnce({
        stdout:
          'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\ncom.example.app/.WorkActivity\n',
        stderr: '',
      } as any);

      await launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        launchArgs,
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger,
      });

      expect(mockedSpawn.mock.calls).toEqual([
        [
          'adb',
          [
            'shell',
            'cmd',
            'package',
            'resolve-activity',
            '--brief',
            '--user',
            '10',
            '-a',
            'android.intent.action.MAIN',
            '-c',
            'android.intent.category.LAUNCHER',
            '-p',
            'com.example.app',
          ],
          { stdio: 'pipe', env: {} },
        ],
        ['adb', expectedLaunchArgs, { env: {}, logger }],
      ]);
    }
  );

  it('resolves the Android launcher activity when activity_name is omitted and preserves launch_args and open_url', async () => {
    const logger = createMockLogger();
    mockedSpawn.mockResolvedValueOnce({
      stdout:
        'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\ncom.example.app/.LauncherAlias\n',
      stderr: '',
    } as any);

    await launchApplicationAsync({
      applicationIdentifier: 'com.example.app',
      launchArgs: ['--es', 'env', 'hello world'],
      openUrl: 'exp://example.test/path?a=1&b=2',
      runtimePlatform: BuildRuntimePlatform.LINUX,
      env: {},
      logger,
    });

    expect(mockedSpawn.mock.calls).toEqual([
      [
        'adb',
        [
          'shell',
          'cmd',
          'package',
          'resolve-activity',
          '--brief',
          '-a',
          'android.intent.action.MAIN',
          '-c',
          'android.intent.category.LAUNCHER',
          '-p',
          'com.example.app',
        ],
        { stdio: 'pipe', env: {} },
      ],
      [
        'adb',
        [
          'shell',
          'am',
          'start',
          '-a',
          'android.intent.action.MAIN',
          '--es',
          'env',
          "'hello world'",
          '-n',
          'com.example.app/com.example.app.LauncherAlias',
        ],
        { env: {}, logger },
      ],
      [
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
        { env: {}, logger },
      ],
    ]);
  });

  it('throws EAS_LAUNCH_APPLICATION_MISSING_ACTIVITY when Android launcher resolution finds no activity', async () => {
    mockedSpawn
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any)
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any);

    await expect(
      launchApplicationAsync({
        applicationIdentifier: 'com.example.app',
        runtimePlatform: BuildRuntimePlatform.LINUX,
        env: {},
        logger: createMockLogger(),
      })
    ).rejects.toMatchObject({
      errorCode: 'EAS_LAUNCH_APPLICATION_MISSING_ACTIVITY',
      message: expect.stringContaining('com.example.app'),
    });

    expect(mockedSpawn.mock.calls).toEqual([
      [
        'adb',
        [
          'shell',
          'cmd',
          'package',
          'resolve-activity',
          '--brief',
          '-a',
          'android.intent.action.MAIN',
          '-c',
          'android.intent.category.LAUNCHER',
          '-p',
          'com.example.app',
        ],
        { stdio: 'pipe', env: {} },
      ],
      [
        'adb',
        [
          'shell',
          'cmd',
          'package',
          'resolve-activity',
          '--brief',
          '-a',
          'android.intent.action.MAIN',
          '-c',
          'android.intent.category.LEANBACK_LAUNCHER',
          '-p',
          'com.example.app',
        ],
        { stdio: 'pipe', env: {} },
      ],
    ]);
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
      ['start', '-a', 'android.intent.action.MAIN', ...launchArgs, '-n', component],
      ['start', '-a', 'android.intent.action.VIEW', '-d', openUrl],
    ]);
  });

  it.each([
    [
      ['--es', 'key', ''],
      ['-a', 'android.intent.action.MAIN'],
    ],
    [
      ['-e', 'key', ''],
      ['-a', 'android.intent.action.MAIN'],
    ],
    [['-d', ''], []],
  ])(
    'passes empty Android option values as empty arguments (%j)',
    async (launchArgs, expectedDefaultActionArgs) => {
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
          ...expectedDefaultActionArgs,
          ...launchArgs.map(argument => (argument === '' ? "''" : argument)),
          '-n',
          'com.example.app/com.example.app.MainActivity',
        ],
        expect.any(Object)
      );
    }
  );

  it('explains an Android launch failure when a launch argument is empty', async () => {
    const launchError = new Error('adb shell am start exited with non-zero code: 1');
    mockedSpawn.mockRejectedValueOnce(launchError);

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
      errorCode: 'EAS_LAUNCH_APPLICATION_FAILED',
      message: expect.stringContaining('empty argument at position 4'),
      cause: launchError,
    });
  });

  it('rethrows an Android launch failure unchanged when no launch argument is empty', async () => {
    const launchError = new Error('adb shell am start exited with non-zero code: 1');
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
    const fixedLength =
      'am start -a android.intent.action.MAIN --es key  -n com.example.app/com.example.app.MainActivity'
        .length;

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
    expect(mockedSpawn).toHaveBeenCalledTimes(1);
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
        '-a',
        'android.intent.action.MAIN',
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

  it('resolves the Android launcher activity when activity_name is omitted in the build step', async () => {
    mockedSpawn.mockResolvedValueOnce({
      stdout:
        'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\ncom.example.app/.MainActivity\n',
      stderr: '',
    } as any);

    const launchApplication = createLaunchApplicationFunction();
    const buildStep = launchApplication.createBuildStepFromFunctionCall(
      createGlobalContextMock({ runtimePlatform: BuildRuntimePlatform.LINUX }),
      {
        callInputs: {
          application_identifier: 'com.example.app',
        },
      }
    );
    await buildStep.executeAsync();

    expect(mockedSpawn).toHaveBeenNthCalledWith(
      1,
      'adb',
      [
        'shell',
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.LAUNCHER',
        '-p',
        'com.example.app',
      ],
      { stdio: 'pipe', env: expect.any(Object) }
    );
    expect(mockedSpawn).toHaveBeenNthCalledWith(
      2,
      'adb',
      [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '-n',
        'com.example.app/com.example.app.MainActivity',
      ],
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
        '-a',
        'android.intent.action.MAIN',
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
