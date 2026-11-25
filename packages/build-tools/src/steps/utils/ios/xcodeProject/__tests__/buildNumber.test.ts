import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';
import plist from 'plist';

import { createMockLogger } from '../../../../../__tests__/utils/logger';
import {
  readEditableInfoPlistsAsync,
  readProjectVersion,
  writeBuildNumberAsync,
} from '../buildNumber';
import { getBuildConfigurations, openXcodeProject } from '../pbxproj';
import { writeSigningBuildSettingsAsync } from '../signing';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));

const originalFs = jest.requireActual('fs');

const xcodeprojPath = '/project/NativeApp.xcodeproj';
const NATIVE_APP_TARGET = { id: '2870BA69F546F142D461562E', name: 'NativeApp' };
const WIDGET_TARGET = { id: '5CAE5500641C3F327B201839', name: 'Widget' };
const NATIVE_APP_INFO_PLIST_SETTINGS = {
  INFOPLIST_FILE: 'NativeApp/Info.plist',
  SRCROOT: '/project',
};
const env = { PATH: '/usr/bin' };

function mockPlutil(xmlByPath: Record<string, string>): void {
  jest.mocked(spawn).mockImplementation((async (_command: string, args: string[]) => {
    const xml = xmlByPath[args.at(-1)!];
    if (xml === undefined) {
      throw new Error('Property List error: Encountered unexpected character #');
    }
    return { stdout: xml };
  }) as any);
}

function readBuildSettings(targetId: string, buildConfiguration: string): Record<string, unknown> {
  return getBuildConfigurations(openXcodeProject(xcodeprojPath), targetId).find(
    ({ name }) => name === buildConfiguration
  )!.buildSettings;
}

afterEach(() => {
  vol.reset();
  jest.mocked(spawn).mockReset();
});

describe(readEditableInfoPlistsAsync, () => {
  it('reads the Info.plist file of each target once, by its path, through plutil', async () => {
    mockPlutil({
      '/project/NativeApp/Info.plist': plist.build({ CFBundleVersion: '7' }),
      '/project/Widget/Info.plist': plist.build({ CFBundleName: 'Widget' }),
    });

    const editableInfoPlistByPath = await readEditableInfoPlistsAsync(
      [
        NATIVE_APP_INFO_PLIST_SETTINGS,
        { INFOPLIST_FILE: '/project/Widget/Info.plist', SRCROOT: '/project' },
        { INFOPLIST_FILE: './NativeApp/Info.plist', SRCROOT: '/project' },
        { SRCROOT: '/project' },
      ],
      { env, logger: createMockLogger() }
    );

    expect([...editableInfoPlistByPath]).toEqual([
      ['/project/NativeApp/Info.plist', { CFBundleVersion: '7' }],
      ['/project/Widget/Info.plist', { CFBundleName: 'Widget' }],
    ]);
    expect(jest.mocked(spawn).mock.calls).toEqual([
      [
        'plutil',
        ['-convert', 'xml1', '-o', '-', '/project/NativeApp/Info.plist'],
        { stdio: 'pipe', env },
      ],
      [
        'plutil',
        ['-convert', 'xml1', '-o', '-', '/project/Widget/Info.plist'],
        { stdio: 'pipe', env },
      ],
    ]);
  });

  it('leaves out a file that Xcode preprocesses for any of its targets, without running plutil on it, and says so', async () => {
    mockPlutil({ '/project/Widget/Info.plist': plist.build({ CFBundleName: 'Widget' }) });
    const logger = createMockLogger();

    const editableInfoPlistByPath = await readEditableInfoPlistsAsync(
      [
        NATIVE_APP_INFO_PLIST_SETTINGS,
        { ...NATIVE_APP_INFO_PLIST_SETTINGS, INFOPLIST_PREPROCESS: '1' },
        { INFOPLIST_FILE: 'Widget/Info.plist', SRCROOT: '/project', INFOPLIST_PREPROCESS: 'NO' },
      ],
      { env, logger }
    );

    expect([...editableInfoPlistByPath.keys()]).toEqual(['/project/Widget/Info.plist']);
    expect(jest.mocked(spawn).mock.calls.map(([, args]) => args!.at(-1))).toEqual([
      '/project/Widget/Info.plist',
    ]);
    expect(jest.mocked(logger.warn).mock.calls).toEqual([
      [
        'Xcode preprocesses "/project/NativeApp/Info.plist" (INFOPLIST_PREPROCESS), so EAS neither reads nor sets the build number in that file.',
      ],
    ]);
  });

  it('warns about a file that plutil does not accept and leaves it out', async () => {
    mockPlutil({ '/project/Widget/Info.plist': plist.build({ CFBundleName: 'Widget' }) });
    const logger = createMockLogger();

    const editableInfoPlistByPath = await readEditableInfoPlistsAsync(
      [
        NATIVE_APP_INFO_PLIST_SETTINGS,
        { INFOPLIST_FILE: 'Widget/Info.plist', SRCROOT: '/project' },
      ],
      { env, logger }
    );

    expect([...editableInfoPlistByPath.keys()]).toEqual(['/project/Widget/Info.plist']);
    expect(jest.mocked(logger.warn).mock.calls).toEqual([
      [
        {
          err: expect.objectContaining({ message: expect.stringContaining('Property List error') }),
        },
        'EAS could not read "/project/NativeApp/Info.plist" as a property list, so it neither reads nor sets the build number in that file.',
      ],
    ]);
  });
});

describe(readProjectVersion, () => {
  const infoPlistPath = '/project/NativeApp/Info.plist';

  it('reads the build settings when Xcode generates the Info.plist file, also when a file has other values', () => {
    expect(
      readProjectVersion(
        {
          ...NATIVE_APP_INFO_PLIST_SETTINGS,
          GENERATE_INFOPLIST_FILE: 'YES',
          CURRENT_PROJECT_VERSION: '42',
          MARKETING_VERSION: '1.2.0',
        },
        new Map([[infoPlistPath, { CFBundleVersion: '7', CFBundleShortVersionString: '0.9' }]])
      )
    ).toEqual({ buildNumber: '42', shortVersion: '1.2.0' });
  });

  it('reads nothing when Xcode generates the Info.plist file and the build settings are not set, also when a file has values', () => {
    expect(
      readProjectVersion(
        {
          ...NATIVE_APP_INFO_PLIST_SETTINGS,
          GENERATE_INFOPLIST_FILE: 'YES',
          CURRENT_PROJECT_VERSION: '',
        },
        new Map([[infoPlistPath, { CFBundleVersion: '7', CFBundleShortVersionString: '0.9' }]])
      )
    ).toEqual({ buildNumber: undefined, shortVersion: undefined });
  });

  it.each(['NO', 'no', 'false', 'on', '0', ''])(
    'reads the Info.plist file when GENERATE_INFOPLIST_FILE is "%s"',
    generateInfoPlistFile => {
      expect(
        readProjectVersion(
          {
            ...NATIVE_APP_INFO_PLIST_SETTINGS,
            GENERATE_INFOPLIST_FILE: generateInfoPlistFile,
            CURRENT_PROJECT_VERSION: '42',
          },
          new Map([[infoPlistPath, { CFBundleVersion: '7' }]])
        ).buildNumber
      ).toBe('7');
    }
  );

  it('reads the Info.plist file and expands the build settings it refers to', () => {
    expect(
      readProjectVersion(
        {
          ...NATIVE_APP_INFO_PLIST_SETTINGS,
          GENERATE_INFOPLIST_FILE: 'NO',
          CURRENT_PROJECT_VERSION: '42',
          PATCH_NUMBER: '3',
          MARKETING_VERSION: '1.2.0',
        },
        new Map([
          [
            infoPlistPath,
            {
              CFBundleVersion: '$(CURRENT_PROJECT_VERSION).${PATCH_NUMBER}',
              CFBundleShortVersionString: '$(MARKETING_VERSION)',
            },
          ],
        ])
      )
    ).toEqual({ buildNumber: '42.3', shortVersion: '1.2.0' });
  });

  it('reads a build number that the Info.plist file holds as a number', () => {
    expect(
      readProjectVersion(
        NATIVE_APP_INFO_PLIST_SETTINGS,
        new Map([[infoPlistPath, { CFBundleVersion: 42 }]])
      )
    ).toEqual({ buildNumber: '42', shortVersion: undefined });
  });

  it('reads nothing when the value refers to a build setting that is not set', () => {
    expect(
      readProjectVersion(
        NATIVE_APP_INFO_PLIST_SETTINGS,
        new Map([[infoPlistPath, { CFBundleVersion: '$(BUILD_NUMBER)' }]])
      )
    ).toEqual({ buildNumber: undefined, shortVersion: undefined });
  });

  it.each([
    ['the target has no Info.plist file', { SRCROOT: '/project' }],
    ['the Info.plist file of the target was left out', NATIVE_APP_INFO_PLIST_SETTINGS],
  ])('reads the build settings when %s', (_description, buildSettings) => {
    expect(
      readProjectVersion(
        { ...buildSettings, CURRENT_PROJECT_VERSION: '42', MARKETING_VERSION: '1.2.0' },
        new Map()
      )
    ).toEqual({ buildNumber: '42', shortVersion: '1.2.0' });
    expect(readProjectVersion(buildSettings, new Map())).toEqual({
      buildNumber: undefined,
      shortVersion: undefined,
    });
  });

  it.each(['YES', 'yes', 'true', 'Y', 'T', '1', '2'])(
    'reads the build settings when GENERATE_INFOPLIST_FILE is %s',
    generateInfoPlistFile => {
      expect(
        readProjectVersion(
          {
            ...NATIVE_APP_INFO_PLIST_SETTINGS,
            GENERATE_INFOPLIST_FILE: generateInfoPlistFile,
            CURRENT_PROJECT_VERSION: '42',
          },
          new Map([[infoPlistPath, { CFBundleVersion: '7' }]])
        ).buildNumber
      ).toBe('42');
    }
  );
});

describe(writeBuildNumberAsync, () => {
  async function writeAsync(
    overrides: Partial<Parameters<typeof writeBuildNumberAsync>[0]> = {}
  ): Promise<void> {
    vol.fromJSON(
      {
        'NativeApp.xcodeproj/project.pbxproj': originalFs
          .readFileSync(path.join(__dirname, 'fixtures/native-app.pbxproj'), 'utf-8')
          .replaceAll(
            'PRODUCT_BUNDLE_IDENTIFIER = dev.expo.nativeapp;',
            [
              'PRODUCT_BUNDLE_IDENTIFIER = dev.expo.nativeapp;',
              'CURRENT_PROJECT_VERSION = 7;',
              '"CURRENT_PROJECT_VERSION[sdk=iphoneos*]" = 9;',
            ].join('\n')
          ),
      },
      '/project'
    );
    await writeBuildNumberAsync({
      xcodeprojPath,
      buildConfiguration: 'Release',
      targets: [NATIVE_APP_TARGET, WIDGET_TARGET],
      editableInfoPlistPaths: [],
      buildNumber: '43',
      env,
      logger: createMockLogger(),
      ...overrides,
    });
  }

  it('sets the build setting on every target for the build configuration and removes its conditional variants', async () => {
    await writeAsync();

    const releaseBuildSettings = readBuildSettings(NATIVE_APP_TARGET.id, 'Release');
    expect(releaseBuildSettings.CURRENT_PROJECT_VERSION).toBe('"43"');
    expect(Object.keys(releaseBuildSettings)).not.toContain(
      '"CURRENT_PROJECT_VERSION[sdk=iphoneos*]"'
    );
    expect(readBuildSettings(WIDGET_TARGET.id, 'Release').CURRENT_PROJECT_VERSION).toBe('"43"');
    expect(readBuildSettings(NATIVE_APP_TARGET.id, 'Debug')).toMatchObject({
      CURRENT_PROJECT_VERSION: 7,
      '"CURRENT_PROJECT_VERSION[sdk=iphoneos*]"': 9,
    });
  });

  it('keeps the build number when the signing settings are written afterwards', async () => {
    await writeAsync();

    await writeSigningBuildSettingsAsync({
      xcodeprojPath,
      buildConfiguration: 'Release',
      targetSignings: [
        {
          target: NATIVE_APP_TARGET,
          buildSettings: {
            PROVISIONING_PROFILE_SPECIFIER: 'App Store Profile',
            DEVELOPMENT_TEAM: 'ABCDE12345',
            CODE_SIGN_IDENTITY: 'iPhone Distribution',
            CODE_SIGN_STYLE: 'Manual',
          },
        },
      ],
    });

    expect(readBuildSettings(NATIVE_APP_TARGET.id, 'Release')).toMatchObject({
      CURRENT_PROJECT_VERSION: '"43"',
      CODE_SIGN_STYLE: '"Manual"',
    });
  });

  it('sets the build number in each Info.plist file through plutil, which keeps the format of the file', async () => {
    jest.mocked(spawn).mockResolvedValue({ stdout: '' } as any);

    await writeAsync({
      editableInfoPlistPaths: ['/project/NativeApp/Info.plist', '/project/Widget/Info.plist'],
    });

    expect(jest.mocked(spawn).mock.calls).toEqual([
      [
        'plutil',
        ['-replace', 'CFBundleVersion', '-string', '43', '/project/NativeApp/Info.plist'],
        { stdio: 'pipe', env },
      ],
      [
        'plutil',
        ['-replace', 'CFBundleVersion', '-string', '43', '/project/Widget/Info.plist'],
        { stdio: 'pipe', env },
      ],
    ]);
  });

  it('warns about an Info.plist file it cannot change and still sets the build number everywhere else', async () => {
    jest
      .mocked(spawn)
      .mockRejectedValueOnce(new Error('Conversion to OpenStep format is not supported'))
      .mockResolvedValueOnce({ stdout: '' } as any);
    const logger = createMockLogger();

    await writeAsync({
      editableInfoPlistPaths: ['/project/NativeApp/Info.plist', '/project/Widget/Info.plist'],
      logger,
    });

    expect(jest.mocked(logger.warn).mock.calls).toEqual([
      [
        { err: expect.any(Error) },
        'EAS could not set the build number in "/project/NativeApp/Info.plist".',
      ],
    ]);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(readBuildSettings(NATIVE_APP_TARGET.id, 'Release').CURRENT_PROJECT_VERSION).toBe('"43"');
  });
});
