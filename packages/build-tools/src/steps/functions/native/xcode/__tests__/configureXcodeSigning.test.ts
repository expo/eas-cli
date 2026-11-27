import { createGlobalContextMock } from '../../../../../__tests__/utils/context';
import { InstalledIosCredentials } from '../../../../utils/ios/credentials/installedCredentials';
import { DistributionType } from '../../../../utils/ios/credentials/provisioningProfile';
import { readBuildSettingsByTargetNameAsync } from '../../../../utils/ios/xcodeProject/buildSettings';
import {
  assertSigningBuildSettingsAreEffective,
  writeSigningBuildSettingsAsync,
} from '../../../../utils/ios/xcodeProject/signing';
import { createConfigureXcodeSigningBuildFunction } from '../configureXcodeSigning';

jest.mock('../../../../utils/ios/xcodeProject/buildSettings');
jest.mock('../../../../utils/ios/xcodeProject/signing');

const TARGETS = [
  { id: 'APP', name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
  { id: 'WIDGET', name: 'Widget', bundleIdentifier: 'dev.expo.nativeapp.widget' },
];

function createStep({
  targets = TARGETS,
  distributionType = DistributionType.APP_STORE,
  certificateCommonName = 'iPhone Distribution: Example (ABCDE12345)',
}: {
  targets?: typeof TARGETS;
  distributionType?: DistributionType;
  certificateCommonName?: string;
} = {}): ReturnType<
  ReturnType<typeof createConfigureXcodeSigningBuildFunction>['createBuildStepFromFunctionCall']
> {
  const installedCredentials: InstalledIosCredentials = {
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
          certificateCommonName,
        },
      ])
    ),
  };
  return createConfigureXcodeSigningBuildFunction().createBuildStepFromFunctionCall(
    createGlobalContextMock(),
    {
      callInputs: {
        xcodeproj_path: '/project/NativeApp.xcodeproj',
        build_configuration: 'Release',
        targets,
        installed_credentials: installedCredentials,
      },
    }
  );
}

beforeEach(() => {
  jest.mocked(readBuildSettingsByTargetNameAsync).mockResolvedValue({ NativeApp: {}, Widget: {} });
});

describe(createConfigureXcodeSigningBuildFunction, () => {
  it('assigns the installed profile of every target and checks that Xcode resolves the settings', async () => {
    await createStep().executeAsync();

    const targetSignings = [
      {
        target: TARGETS[0],
        buildSettings: {
          PROVISIONING_PROFILE_SPECIFIER: 'NativeApp Profile',
          DEVELOPMENT_TEAM: 'ABCDE12345',
          CODE_SIGN_IDENTITY: 'iPhone Distribution',
          CODE_SIGN_STYLE: 'Manual',
        },
      },
      {
        target: TARGETS[1],
        buildSettings: {
          PROVISIONING_PROFILE_SPECIFIER: 'Widget Profile',
          DEVELOPMENT_TEAM: 'ABCDE12345',
          CODE_SIGN_IDENTITY: 'iPhone Distribution',
          CODE_SIGN_STYLE: 'Manual',
        },
      },
    ];
    expect(writeSigningBuildSettingsAsync).toHaveBeenCalledWith({
      xcodeprojPath: '/project/NativeApp.xcodeproj',
      buildConfiguration: 'Release',
      targetSignings,
    });
    expect(readBuildSettingsByTargetNameAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        xcodeprojPath: '/project/NativeApp.xcodeproj',
        targetNames: ['NativeApp', 'Widget'],
        buildConfiguration: 'Release',
      })
    );
    expect(assertSigningBuildSettingsAreEffective).toHaveBeenCalledWith({
      buildConfiguration: 'Release',
      targetSignings,
      effectiveBuildSettingsByTargetName: { NativeApp: {}, Widget: {} },
    });
  });

  it.each([
    [DistributionType.ENTERPRISE, 'iPhone Distribution'],
    [DistributionType.AD_HOC, 'iPhone Distribution'],
    [DistributionType.DEVELOPMENT, 'Apple Development: Example (ABCDE12345)'],
  ])('signs a %s build with the identity "%s"', async (distributionType, expectedIdentity) => {
    await createStep({
      targets: [TARGETS[0]],
      distributionType,
      certificateCommonName: 'Apple Development: Example (ABCDE12345)',
    }).executeAsync();

    expect(
      jest.mocked(writeSigningBuildSettingsAsync).mock.calls[0][0].targetSignings[0].buildSettings
        .CODE_SIGN_IDENTITY
    ).toBe(expectedIdentity);
  });

  it.each([
    [
      'a path relative to the source root',
      { SRCROOT: '/project/app', CODE_SIGN_ENTITLEMENTS: 'NativeApp/NativeApp.entitlements' },
      '/project/app/NativeApp/NativeApp.entitlements',
    ],
    [
      'an absolute path',
      { SRCROOT: '/project/app', CODE_SIGN_ENTITLEMENTS: '/project/Shared/App.entitlements' },
      '/project/Shared/App.entitlements',
    ],
    ['nothing', { SRCROOT: '/project/app' }, undefined],
  ])(
    'outputs the entitlements file that Xcode resolves for the application target after signing is configured, when it is given as %s',
    async (_description, applicationBuildSettings, entitlementsPath) => {
      jest.mocked(readBuildSettingsByTargetNameAsync).mockResolvedValue({
        NativeApp: applicationBuildSettings,
        Widget: { SRCROOT: '/project/app', CODE_SIGN_ENTITLEMENTS: 'Widget.entitlements' },
      });
      const step = createStep();

      await step.executeAsync();

      expect(step.outputById.entitlements_path.value).toBe(entitlementsPath);
      expect(jest.mocked(writeSigningBuildSettingsAsync).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(readBuildSettingsByTargetNameAsync).mock.invocationCallOrder[0]
      );
    }
  );
});
