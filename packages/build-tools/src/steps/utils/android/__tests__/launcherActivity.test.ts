import spawn from '@expo/turtle-spawn';

import {
  parseLaunchableActivityFromBadging,
  parseLeanbackLaunchableActivityFromBadging,
  parseResolvedAndroidActivity,
  resolveAndroidLauncherActivityAsync,
} from '../launcherActivity';

jest.mock('@expo/turtle-spawn', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockedSpawn = jest.mocked(spawn);

describe(parseLaunchableActivityFromBadging, () => {
  it('extracts launchable-activity from aapt2 dump badging output', () => {
    const stdout = [
      "package: name='com.example.app' versionCode='1' versionName='1.0'",
      "launchable-activity: name='com.example.app.MainActivity'  label='Example' icon=''",
    ].join('\n');

    expect(parseLaunchableActivityFromBadging(stdout)).toBe('com.example.app.MainActivity');
  });

  it('ignores leanback-launchable-activity so package manager can resolve an enabled phone launcher first', () => {
    const stdout = [
      "package: name='com.example.app'",
      "leanback-launchable-activity: name='com.example.app.DisabledTvActivity'  label='' icon=''",
    ].join('\n');

    expect(parseLaunchableActivityFromBadging(stdout)).toBeUndefined();
    expect(parseLeanbackLaunchableActivityFromBadging(stdout)).toBe(
      'com.example.app.DisabledTvActivity'
    );
  });

  it('prefers launchable-activity even when leanback-launchable-activity appears earlier', () => {
    const stdout = [
      "package: name='com.example.app'",
      "leanback-launchable-activity: name='com.example.app.TvActivity'  label='' icon=''",
      "launchable-activity: name='com.example.app.MainActivity'  label='' icon=''",
    ].join('\n');

    expect(parseLaunchableActivityFromBadging(stdout)).toBe('com.example.app.MainActivity');
  });

  it('returns undefined when neither activity entry is present', () => {
    expect(parseLaunchableActivityFromBadging("package: name='com.example.app'\n")).toBeUndefined();
    expect(
      parseLeanbackLaunchableActivityFromBadging("package: name='com.example.app'\n")
    ).toBeUndefined();
  });
});

describe(parseResolvedAndroidActivity, () => {
  it('expands a relative activity name against the package name', () => {
    const stdout =
      'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\r\ncom.example.app/.MainActivity\r\n';

    expect(parseResolvedAndroidActivity(stdout, 'com.example.app')).toBe(
      'com.example.app.MainActivity'
    );
  });

  it('expands nested relative activity names and preserves inner class suffixes', () => {
    const stdout =
      'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\ncom.example.app/.ui.MainActivity$Default\n';

    expect(parseResolvedAndroidActivity(stdout, 'com.example.app')).toBe(
      'com.example.app.ui.MainActivity$Default'
    );
  });

  it('preserves a fully qualified activity name from a different Java package', () => {
    const stdout =
      'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.example.app.dev/com.example.app.MainActivity\n';

    expect(parseResolvedAndroidActivity(stdout, 'com.example.app.dev')).toBe(
      'com.example.app.MainActivity'
    );
  });

  it('returns undefined for No activity found, empty output, or foreign resolver components', () => {
    expect(parseResolvedAndroidActivity('No activity found\n', 'com.example.app')).toBeUndefined();
    expect(parseResolvedAndroidActivity('', 'com.example.app')).toBeUndefined();
    expect(
      parseResolvedAndroidActivity(
        'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\nandroid/com.android.internal.app.ResolverActivity\n',
        'com.example.app'
      )
    ).toBeUndefined();
    expect(
      parseResolvedAndroidActivity(
        'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.android.car.activityresolver/.CarResolverActivity\n',
        'com.example.app'
      )
    ).toBeUndefined();
    expect(parseResolvedAndroidActivity('com.example.app/.\n', 'com.example.app')).toBeUndefined();
  });
});

describe(resolveAndroidLauncherActivityAsync, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSpawn.mockResolvedValue({ stdout: '', stderr: '' } as any);
  });

  it('resolves the standard launcher activity in a single adb call with explicit MAIN/LAUNCHER flags', async () => {
    mockedSpawn.mockResolvedValueOnce({
      stdout:
        'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\ncom.example.app/.MainActivityAlias\n',
      stderr: '',
    } as any);

    const activity = await resolveAndroidLauncherActivityAsync({
      applicationIdentifier: 'com.example.app',
      env: { PATH: '/usr/bin' },
    });

    expect(activity).toBe('com.example.app.MainActivityAlias');
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
        { stdio: 'pipe', env: { PATH: '/usr/bin' } },
      ],
    ]);
  });

  it.each([
    [
      'stock Android ResolverActivity',
      'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\nandroid/com.android.internal.app.ResolverActivity\n',
    ],
    [
      'custom OEM/Automotive resolver',
      'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.android.car.activityresolver/.CarResolverActivity\n',
    ],
  ])(
    'falls back to package-scoped query-activities when resolve-activity returns %s',
    async (_label, resolverOutput) => {
      mockedSpawn
        .mockResolvedValueOnce({ stdout: resolverOutput, stderr: '' } as any)
        .mockResolvedValueOnce({
          stdout: [
            'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false',
            '  com.example.app/.PrimaryAlias',
            'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false',
            '  com.example.app/.SecondaryAlias',
          ].join('\n'),
          stderr: '',
        } as any);

      const activity = await resolveAndroidLauncherActivityAsync({
        applicationIdentifier: 'com.example.app',
        env: {},
      });

      expect(activity).toBe('com.example.app.PrimaryAlias');
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
            'query-activities',
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
      ]);
    }
  );

  it('rejects foreign components returned by query-activities', async () => {
    mockedSpawn
      .mockResolvedValueOnce({
        stdout:
          'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.android.car.activityresolver/.CarResolverActivity\n',
        stderr: '',
      } as any)
      .mockResolvedValueOnce({
        stdout:
          'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.other.app/.OtherActivity\n',
        stderr: '',
      } as any)
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any);

    const activity = await resolveAndroidLauncherActivityAsync({
      applicationIdentifier: 'com.example.app',
      env: {},
    });

    expect(activity).toBeUndefined();
  });

  it('falls back to LEANBACK_LAUNCHER when standard launcher resolution returns No activity found', async () => {
    mockedSpawn
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any)
      .mockResolvedValueOnce({
        stdout:
          'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.example.tv/.TvMainActivity\n',
        stderr: '',
      } as any);

    const activity = await resolveAndroidLauncherActivityAsync({
      applicationIdentifier: 'com.example.tv',
      env: {},
    });

    expect(activity).toBe('com.example.tv.TvMainActivity');
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
          'com.example.tv',
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
          'com.example.tv',
        ],
        { stdio: 'pipe', env: {} },
      ],
    ]);
  });

  it('keeps dash-prefixed application identifiers in the -p package argument position', async () => {
    mockedSpawn
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any)
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any);

    await resolveAndroidLauncherActivityAsync({
      applicationIdentifier: '--user',
      env: {},
    });

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
        '--user',
      ],
      { stdio: 'pipe', env: {} }
    );
  });

  it('forwards --user to both resolve-activity and query-activities when specified', async () => {
    mockedSpawn
      .mockResolvedValueOnce({
        stdout:
          'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\nandroid/com.android.internal.app.ResolverActivity\n',
        stderr: '',
      } as any)
      .mockResolvedValueOnce({
        stdout:
          'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\ncom.example.app/.WorkProfileActivity\n',
        stderr: '',
      } as any);

    const activity = await resolveAndroidLauncherActivityAsync({
      applicationIdentifier: 'com.example.app',
      user: '10',
      env: {},
    });

    expect(activity).toBe('com.example.app.WorkProfileActivity');
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
      [
        'adb',
        [
          'shell',
          'cmd',
          'package',
          'query-activities',
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
    ]);
  });

  it('returns undefined when neither standard nor leanback launcher exists', async () => {
    mockedSpawn
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any)
      .mockResolvedValueOnce({ stdout: 'No activity found\n', stderr: '' } as any);

    const activity = await resolveAndroidLauncherActivityAsync({
      applicationIdentifier: 'com.example.service',
      env: {},
    });

    expect(activity).toBeUndefined();
    expect(mockedSpawn).toHaveBeenCalledTimes(2);
  });
});
