import { vol } from 'memfs';
import os from 'os';
import path from 'path';

import { createGlobalContextMock } from '../../../../../__tests__/utils/context';
import { InstalledIosCredentials } from '../../../../utils/ios/credentials/installedCredentials';
import { DistributionType } from '../../../../utils/ios/credentials/provisioningProfile';
import { runFastlaneGym } from '../../../../utils/ios/fastlane';
import { createBuildNativeIosBuildFunction } from '../buildNativeIos';

jest.mock('../../../../utils/ios/fastlane');

const projectDirectory = '/project';
const TARGETS = [
  { id: 'APP', name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
  { id: 'WIDGET', name: 'Widget', bundleIdentifier: 'dev.expo.nativeapp.widget' },
];
function installedCredentials(
  distributionType: DistributionType,
  targets: typeof TARGETS = TARGETS
): InstalledIosCredentials {
  return {
    keychainPath: '/keychains/build.keychain',
    distributionType,
    profileByTargetName: Object.fromEntries(
      targets.map(({ name, bundleIdentifier }) => [
        name,
        {
          bundleIdentifier,
          profileName: `${name} Profile`,
          profileUuid: `${name}-uuid`,
          teamId: 'ABCDE12345',
          certificateCommonName: 'iPhone Distribution: Example (ABCDE12345)',
        },
      ])
    ),
  };
}

function infoPlist(bundleIdentifier: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleIdentifier}</string></dict></plist>`;
}

function createBuildStep({
  projectFile = '/project/NativeApp.xcodeproj',
  targets = TARGETS,
  distributionType,
  entitlementsPath,
}: {
  projectFile?: string;
  targets?: typeof TARGETS;
  distributionType?: DistributionType;
  entitlementsPath?: string;
} = {}): ReturnType<
  ReturnType<typeof createBuildNativeIosBuildFunction>['createBuildStepFromFunctionCall']
> {
  const globalCtx = createGlobalContextMock({ projectTargetDirectory: projectDirectory });
  return createBuildNativeIosBuildFunction().createBuildStepFromFunctionCall(globalCtx, {
    callInputs: {
      project_file: projectFile,
      scheme: 'NativeApp',
      build_configuration: 'Release',
      targets,
      ...(distributionType && {
        installed_credentials: installedCredentials(distributionType, targets),
      }),
      entitlements_path: entitlementsPath,
    },
  });
}

function mockGymProducing(relativePaths: Record<string, string>): { gymfile: () => string } {
  let gymfileDirectory = '';
  jest.mocked(runFastlaneGym).mockImplementation(async options => {
    gymfileDirectory = options.gymfileDirectory!;
    vol.fromJSON(relativePaths, gymfileDirectory);
  });
  return {
    gymfile: () => vol.readFileSync(path.join(gymfileDirectory, 'Gymfile'), 'utf-8') as string,
  };
}

beforeEach(() => {
  vol.fromJSON({ [path.join(os.tmpdir(), 'placeholder')]: '', '/project/placeholder': '' });
});

afterEach(() => {
  vol.reset();
});

describe(createBuildNativeIosBuildFunction, () => {
  it('archives and exports with the installed credentials of every target', async () => {
    const gym = mockGymProducing({ 'output/NativeApp.ipa': '' });
    const step = createBuildStep({ distributionType: DistributionType.APP_STORE });

    await step.executeAsync();

    const gymfile = gym.gymfile();
    expect(gymfile).toContain('project("/project/NativeApp.xcodeproj")');
    expect(gymfile).toContain('xcargs("-skipPackagePluginValidation -skipMacroValidation")');
    expect(gymfile).toContain('scheme("NativeApp")');
    expect(gymfile).toContain('configuration("Release")');
    expect(gymfile).toContain('method: "app-store"');
    expect(gymfile).toContain('"dev.expo.nativeapp" => "NativeApp-uuid"');
    expect(gymfile).toContain('"dev.expo.nativeapp.widget" => "Widget-uuid"');
    expect(gymfile).toContain('--keychain /keychains/build.keychain');
    expect(step.outputById.archive_path.value).toMatch(
      /native-ios-build-[^/]+\/output\/NativeApp\.ipa$/
    );
    expect(path.isAbsolute(step.outputById.archive_path.value as string)).toBe(true);
  });

  it('exports with the method of the installed provisioning profiles', async () => {
    const gym = mockGymProducing({ 'output/NativeApp.ipa': '' });
    const step = createBuildStep({
      targets: [TARGETS[0]],
      distributionType: DistributionType.ENTERPRISE,
    });

    await step.executeAsync();

    expect(gym.gymfile()).toContain('method: "enterprise"');
  });

  it('builds for the simulator when it is given no installed credentials, and returns the app with the bundle identifier', async () => {
    const products = 'derived-data/Build/Products/Release-iphonesimulator';
    const gym = mockGymProducing({
      [`${products}/Clip.app/Info.plist`]: infoPlist('dev.expo.nativeapp.clip'),
      [`${products}/NativeApp.app/Info.plist`]: infoPlist('dev.expo.nativeapp'),
    });
    const step = createBuildStep({
      projectFile: '/project/NativeApp.xcworkspace',
      targets: [TARGETS[0]],
    });

    await step.executeAsync();

    const gymfile = gym.gymfile();
    expect(gymfile).toContain('workspace("/project/NativeApp.xcworkspace")');
    expect(gymfile).toContain('destination("generic/platform=iOS Simulator")');
    expect(gymfile).toContain('xcargs("-skipPackagePluginValidation -skipMacroValidation")');
    expect(gymfile).not.toContain('export_options');
    expect(step.outputById.archive_path.value).toMatch(/Release-iphonesimulator\/NativeApp\.app$/);
    expect(runFastlaneGym).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDir: projectDirectory,
        gymfileDirectory: expect.stringContaining('native-ios-build-'),
      })
    );
  });

  it('fails with a user error that points to the logs when the Xcode build fails', async () => {
    const gymError = new Error('fastlane exited with non-zero code: 1');
    jest.mocked(runFastlaneGym).mockRejectedValue(gymError);
    const step = createBuildStep({ targets: [TARGETS[0]] });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_BUILD_FAILED',
      message: expect.stringContaining('The errors are in the "Build with Xcode" step.'),
      cause: gymError,
    });
  });

  it('rejects a targets input that is not the list the detection step produces', async () => {
    const step = createBuildStep({ targets: [{ id: 'APP', name: 'NativeApp' }] as any });

    await expect(step.executeAsync()).rejects.toThrow(/bundleIdentifier/);
    expect(runFastlaneGym).not.toHaveBeenCalled();
  });

  it('fails when the build produced no archive', async () => {
    mockGymProducing({ 'output/placeholder': '' });
    const step = createBuildStep({
      targets: [TARGETS[0]],
      distributionType: DistributionType.AD_HOC,
    });

    await expect(step.executeAsync()).rejects.toMatchObject({
      errorCode: 'NATIVE_XCODE_NO_BUILD_OUTPUT',
    });
  });

  describe('the iCloud container environment of the export', () => {
    const ENTITLEMENTS_PATH = '/project/NativeApp/NativeApp.entitlements';

    function entitlementsWithEnvironment(environment: string): string {
      return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>com.apple.developer.icloud-container-environment</key><string>${environment}</string></dict></plist>`;
    }
    const ENTITLEMENTS_WITHOUT_ENVIRONMENT = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>aps-environment</key><string>production</string></dict></plist>`;

    async function exportAsync({
      entitlementsPath,
      files = {},
    }: {
      entitlementsPath?: string;
      files?: Record<string, string>;
    }): Promise<{ gymfile: string; warn: jest.Mock }> {
      vol.fromJSON(files);
      const gym = mockGymProducing({ 'output/NativeApp.ipa': '' });
      const step = createBuildStep({ distributionType: DistributionType.AD_HOC, entitlementsPath });

      await step.executeAsync();

      return { gymfile: gym.gymfile(), warn: jest.mocked(step.ctx.logger.warn) };
    }

    it('passes the value of the entitlements file it is given', async () => {
      const { gymfile, warn } = await exportAsync({
        entitlementsPath: ENTITLEMENTS_PATH,
        files: { [ENTITLEMENTS_PATH]: entitlementsWithEnvironment('Development') },
      });

      expect(gymfile).toContain('iCloudContainerEnvironment: "Development"');
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      ['it is given no entitlements file', undefined, {}],
      [
        'the entitlements file does not name an environment',
        ENTITLEMENTS_PATH,
        { [ENTITLEMENTS_PATH]: ENTITLEMENTS_WITHOUT_ENVIRONMENT },
      ],
      [
        'the environment in the entitlements file is empty',
        ENTITLEMENTS_PATH,
        { [ENTITLEMENTS_PATH]: entitlementsWithEnvironment('') },
      ],
    ])(
      'passes no value and does not warn when %s',
      async (_description, entitlementsPath, files) => {
        const { gymfile, warn } = await exportAsync({ entitlementsPath, files });

        expect(gymfile).not.toContain('iCloudContainerEnvironment');
        expect(warn).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['is missing', {}],
      ['is not a property list', { [ENTITLEMENTS_PATH]: 'not a property list' }],
      [
        'holds null in place of a dictionary',
        { [ENTITLEMENTS_PATH]: '<plist version="1.0"><null/></plist>' },
      ],
    ])(
      'warns and exports without a value when the entitlements file %s',
      async (_description, files) => {
        const { gymfile, warn } = await exportAsync({ entitlementsPath: ENTITLEMENTS_PATH, files });

        expect(gymfile).not.toContain('iCloudContainerEnvironment');
        expect(warn).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining(`could not read the entitlements file "${ENTITLEMENTS_PATH}"`)
        );
      }
    );
  });
});
