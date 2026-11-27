import spawn from '@expo/turtle-spawn';
import { vol } from 'memfs';
import path from 'path';

import { createGlobalContextMock } from '../../../../../__tests__/utils/context';
import { createDetectNativeXcodeBuildFunction } from '../detectNativeXcode';

jest.mock('@expo/turtle-spawn', () => ({ __esModule: true, default: jest.fn() }));

const originalFs = jest.requireActual('fs');

const projectDirectory = '/project';
const fixturesDirectory = path.join(
  __dirname,
  '../../../../utils/ios/xcodeProject/__tests__/fixtures'
);
const FRAMEWORK_ONLY_SCHEME = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme version = "1.3">
  <BuildAction>
    <BuildActionEntries>
      <BuildActionEntry buildForArchiving = "YES">
        <BuildableReference
          BuildableIdentifier = "primary"
          BlueprintIdentifier = "BBCC7F97904CEBE3743A2D6F"
          BuildableName = "Core.framework"
          BlueprintName = "Core"
          ReferencedContainer = "container:NativeApp.xcodeproj">
        </BuildableReference>
      </BuildActionEntry>
    </BuildActionEntries>
  </BuildAction>
  <LaunchAction buildConfiguration = "Debug"></LaunchAction>
  <ArchiveAction buildConfiguration = "Release"></ArchiveAction>
</Scheme>`;

function writeProject(
  extraFiles: Record<string, string> = {},
  directory: string = projectDirectory
): void {
  vol.fromJSON(
    {
      'NativeApp.xcodeproj/project.pbxproj': originalFs.readFileSync(
        path.join(fixturesDirectory, 'native-app.pbxproj'),
        'utf-8'
      ),
      'NativeApp.xcodeproj/xcshareddata/xcschemes/NativeApp.xcscheme': originalFs.readFileSync(
        path.join(fixturesDirectory, 'native-app.xcscheme'),
        'utf-8'
      ),
      ...extraFiles,
    },
    directory
  );
}

const APPLICATION_BUILD_SETTINGS = {
  PLATFORM_NAME: 'iphoneos',
  PRODUCT_BUNDLE_IDENTIFIER: 'dev.expo.nativeapp',
  PROVISIONING_PROFILE_REQUIRED: 'YES',
};
const WIDGET_BUILD_SETTINGS = {
  PLATFORM_NAME: 'iphoneos',
  PRODUCT_BUNDLE_IDENTIFIER: 'dev.expo.nativeapp.widget',
  PROVISIONING_PROFILE_REQUIRED: 'YES',
};
const BUILD_SETTINGS_BY_TARGET_NAME = {
  NativeApp: APPLICATION_BUILD_SETTINGS,
  Widget: WIDGET_BUILD_SETTINGS,
  Core: { PLATFORM_NAME: 'iphoneos', PRODUCT_BUNDLE_IDENTIFIER: 'dev.expo.nativeapp.core' },
  Support: { PLATFORM_NAME: 'iphoneos' },
};

function mockBuildSettings(
  ...buildSettingsByTargetNameOfEachCall: Record<string, Record<string, string>>[]
): void {
  for (const buildSettingsByTargetName of buildSettingsByTargetNameOfEachCall) {
    jest.mocked(spawn).mockResolvedValueOnce({
      stdout: JSON.stringify(
        Object.entries(buildSettingsByTargetName).map(([target, buildSettings]) => ({
          action: 'build',
          target,
          buildSettings,
        }))
      ),
    } as any);
  }
}

function createDetectStep({
  job,
  callInputs = {},
  baseDirectory,
  workingDirectory,
}: {
  job: Record<string, unknown>;
  callInputs?: Record<string, unknown>;
  baseDirectory?: string;
  workingDirectory?: string;
}): ReturnType<
  ReturnType<typeof createDetectNativeXcodeBuildFunction>['createBuildStepFromFunctionCall']
> {
  const globalCtx = createGlobalContextMock({
    projectTargetDirectory: projectDirectory,
    relativeWorkingDirectory: baseDirectory,
    staticContextContent: { job },
  });
  globalCtx.markAsCheckedOut();
  return createDetectNativeXcodeBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    callInputs,
    workingDirectory,
  });
}

const signedJob = { simulator: false };

afterEach(() => {
  vol.reset();
  jest.mocked(spawn).mockReset();
});

describe(createDetectNativeXcodeBuildFunction, () => {
  it('detects the project, the scheme, the archive configuration and the targets that need a provisioning profile', async () => {
    writeProject();
    mockBuildSettings(BUILD_SETTINGS_BY_TARGET_NAME);
    const step = createDetectStep({
      job: signedJob,
      callInputs: { expected_identifier: 'dev.expo.nativeapp' },
    });

    await step.executeAsync();

    expect(step.outputById.project_file.value).toBe('/project/NativeApp.xcodeproj');
    expect(step.outputById.scheme.value).toBe('NativeApp');
    expect(step.outputById.build_configuration.value).toBe('Release');
    expect(step.outputById.xcodeproj_path.value).toBe('/project/NativeApp.xcodeproj');
    expect(JSON.parse(step.outputById.targets.value as string)).toEqual([
      { id: '2870BA69F546F142D461562E', name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
      {
        id: '5CAE5500641C3F327B201839',
        name: 'Widget',
        bundleIdentifier: 'dev.expo.nativeapp.widget',
      },
    ]);
    expect(spawn).toHaveBeenCalledWith(
      'xcodebuild',
      [
        '-project',
        '/project/NativeApp.xcodeproj',
        '-target',
        'NativeApp',
        '-target',
        'Widget',
        '-target',
        'Core',
        '-target',
        'Support',
        '-configuration',
        'Release',
        '-showBuildSettings',
        '-json',
      ],
      expect.anything()
    );
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('detects the project in the working directory of the step', async () => {
    writeProject({}, '/project/apps/mobile/ios');
    mockBuildSettings(BUILD_SETTINGS_BY_TARGET_NAME);
    const step = createDetectStep({
      job: signedJob,
      baseDirectory: 'apps/mobile',
      workingDirectory: 'ios',
    });

    await step.executeAsync();

    expect(step.outputById.project_file.value).toBe('/project/apps/mobile/ios/NativeApp.xcodeproj');
  });

  it('fails with the directory it searched and the base directory when the working directory of the step does not exist', async () => {
    writeProject({}, '/project/apps/mobile/ios');
    const step = createDetectStep({
      job: signedJob,
      baseDirectory: 'apps/mobile',
      workingDirectory: 'apps/mobile/ios',
    });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_PROJECT_FILE_NOT_FOUND',
      message: expect.stringMatching(
        /in "\/apps\/mobile\/apps\/mobile\/ios" .*the app's base directory, which is "\/apps\/mobile"\./
      ),
    });
  });

  it('reads the settings again with the iOS SDK for the targets that Xcode resolved no platform for', async () => {
    writeProject();
    mockBuildSettings(
      {
        ...BUILD_SETTINGS_BY_TARGET_NAME,
        Widget: { PRODUCT_BUNDLE_IDENTIFIER: 'dev.expo.nativeapp.widget' },
        Support: {},
      },
      { Widget: WIDGET_BUILD_SETTINGS, Support: { PLATFORM_NAME: 'iphoneos' } }
    );
    const step = createDetectStep({ job: signedJob });

    await step.executeAsync();

    expect(JSON.parse(step.outputById.targets.value as string)).toEqual([
      { id: '2870BA69F546F142D461562E', name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
      {
        id: '5CAE5500641C3F327B201839',
        name: 'Widget',
        bundleIdentifier: 'dev.expo.nativeapp.widget',
      },
    ]);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(jest.mocked(spawn).mock.calls[1][1]).toEqual([
      '-project',
      '/project/NativeApp.xcodeproj',
      '-target',
      'Widget',
      '-target',
      'Support',
      '-configuration',
      'Release',
      '-sdk',
      'iphoneos',
      '-showBuildSettings',
      '-json',
    ]);
  });

  it('uses the Run configuration, the simulator SDK and only the application target for a simulator build', async () => {
    writeProject();
    mockBuildSettings({ NativeApp: APPLICATION_BUILD_SETTINGS });
    const step = createDetectStep({ job: { simulator: true } });

    await step.executeAsync();

    expect(step.outputById.build_configuration.value).toBe('Debug');
    expect(JSON.parse(step.outputById.targets.value as string)).toEqual([
      { id: '2870BA69F546F142D461562E', name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
    ]);
    expect(jest.mocked(spawn).mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        '-target',
        'NativeApp',
        '-configuration',
        'Debug',
        '-sdk',
        'iphonesimulator',
      ])
    );
    expect(jest.mocked(spawn).mock.calls[0][1]).not.toContain('Widget');
  });

  it('uses the given build configuration', async () => {
    writeProject();
    mockBuildSettings(BUILD_SETTINGS_BY_TARGET_NAME);
    const step = createDetectStep({
      job: signedJob,
      callInputs: { build_configuration: 'Debug' },
    });

    await step.executeAsync();

    expect(step.outputById.build_configuration.value).toBe('Debug');
  });

  it('fails with the build configurations of the target when the given one does not exist', async () => {
    writeProject();
    const step = createDetectStep({
      job: signedJob,
      callInputs: { build_configuration: 'Staging' },
    });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_BUILD_CONFIGURATION_NOT_FOUND',
      message: expect.stringContaining(
        '"Staging". Build configurations of the target: Debug, Release.'
      ),
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails when the bundle identifier differs from the expected identifier', async () => {
    writeProject();
    mockBuildSettings(BUILD_SETTINGS_BY_TARGET_NAME);
    const step = createDetectStep({
      job: signedJob,
      callInputs: { expected_identifier: 'dev.expo.other' },
    });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_APP_IDENTIFIER_MISMATCH',
      message: expect.stringMatching(/"dev\.expo\.other".*"NativeApp".*"dev\.expo\.nativeapp"/),
    });
  });

  it('fails when a target that needs a provisioning profile has no bundle identifier', async () => {
    writeProject();
    mockBuildSettings({
      ...BUILD_SETTINGS_BY_TARGET_NAME,
      Widget: { PLATFORM_NAME: 'iphoneos', PROVISIONING_PROFILE_REQUIRED: 'YES' },
    });
    const step = createDetectStep({ job: signedJob });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_NO_BUNDLE_IDENTIFIER',
      message: expect.stringContaining('The target "Widget" has no bundle identifier'),
    });
  });

  it('fails with the other schemes when the scheme builds no application', async () => {
    writeProject({
      'NativeApp.xcodeproj/xcshareddata/xcschemes/Core.xcscheme': FRAMEWORK_ONLY_SCHEME,
    });
    const step = createDetectStep({ job: signedJob, callInputs: { scheme: 'Core' } });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_NO_APPLICATION_TARGET',
      message: expect.stringMatching(/scheme "Core".*Other shared schemes: NativeApp\./),
    });
  });

  it('outputs the version and the build number of the application target, and the Info.plist files that carry the number, when it is asked to read the version', async () => {
    writeProject();
    mockBuildSettings({
      ...BUILD_SETTINGS_BY_TARGET_NAME,
      NativeApp: {
        ...APPLICATION_BUILD_SETTINGS,
        GENERATE_INFOPLIST_FILE: 'YES',
        MARKETING_VERSION: '1.2.0',
        CURRENT_PROJECT_VERSION: '7',
      },
      Widget: { ...WIDGET_BUILD_SETTINGS, CURRENT_PROJECT_VERSION: '3' },
    });
    const step = createDetectStep({ job: signedJob, callInputs: { read_version: true } });

    await step.executeAsync();

    expect(step.outputById.application_identifier.value).toBe('dev.expo.nativeapp');
    expect(step.outputById.app_version.value).toBe('1.2.0');
    expect(step.outputById.build_number.value).toBe('7');
    expect(step.outputById.editable_info_plist_paths.value).toBe('[]');
    expect(step.ctx.logger.info).toHaveBeenCalledWith('Version: 1.2.0. Build number: 7.');
  });

  it('outputs no version and no build number when the application target names none', async () => {
    writeProject();
    mockBuildSettings(BUILD_SETTINGS_BY_TARGET_NAME);
    const step = createDetectStep({ job: signedJob, callInputs: { read_version: true } });

    await step.executeAsync();

    expect(step.outputById.app_version.value).toBeUndefined();
    expect(step.outputById.build_number.value).toBeUndefined();
    expect(step.ctx.logger.info).toHaveBeenCalledWith('Version: none. Build number: none.');
  });

  it('reads the build number from the Info.plist file of the application target and outputs the path of every file it can edit', async () => {
    writeProject();
    mockBuildSettings({
      ...BUILD_SETTINGS_BY_TARGET_NAME,
      NativeApp: {
        ...APPLICATION_BUILD_SETTINGS,
        SRCROOT: '/project',
        INFOPLIST_FILE: 'NativeApp/Info.plist',
        CURRENT_PROJECT_VERSION: '7',
      },
    });
    jest.mocked(spawn).mockResolvedValueOnce({
      stdout: `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleVersion</key><string>42</string></dict></plist>`,
    } as any);
    const step = createDetectStep({ job: signedJob, callInputs: { read_version: true } });

    await step.executeAsync();

    expect(step.outputById.build_number.value).toBe('42');
    expect(JSON.parse(step.outputById.editable_info_plist_paths.value as string)).toEqual([
      '/project/NativeApp/Info.plist',
    ]);
  });

  it('does not read the build number from an Info.plist file that another signed target preprocesses', async () => {
    writeProject();
    const sharedInfoPlist = { SRCROOT: '/project', INFOPLIST_FILE: 'Shared/Info.plist' };
    mockBuildSettings({
      ...BUILD_SETTINGS_BY_TARGET_NAME,
      NativeApp: {
        ...APPLICATION_BUILD_SETTINGS,
        ...sharedInfoPlist,
        CURRENT_PROJECT_VERSION: '41',
      },
      Widget: { ...WIDGET_BUILD_SETTINGS, ...sharedInfoPlist, INFOPLIST_PREPROCESS: 'YES' },
    });
    const step = createDetectStep({ job: signedJob, callInputs: { read_version: true } });

    await step.executeAsync();

    expect(step.outputById.build_number.value).toBe('41');
    expect(step.outputById.editable_info_plist_paths.value).toBe('[]');
    expect(spawn).not.toHaveBeenCalledWith('plutil', expect.anything(), expect.anything());
  });

  it('does not read the version and the build number when it is not asked to', async () => {
    writeProject();
    mockBuildSettings({
      ...BUILD_SETTINGS_BY_TARGET_NAME,
      NativeApp: {
        ...APPLICATION_BUILD_SETTINGS,
        SRCROOT: '/project',
        INFOPLIST_FILE: 'NativeApp/Info.plist',
        CURRENT_PROJECT_VERSION: '7',
      },
    });
    const step = createDetectStep({ job: signedJob });

    await step.executeAsync();

    expect(step.outputById.build_number.value).toBeUndefined();
    expect(step.outputById.editable_info_plist_paths.value).toBeUndefined();
    expect(spawn).not.toHaveBeenCalledWith('plutil', expect.anything(), expect.anything());
    expect(step.ctx.logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Version:'));
  });
});
