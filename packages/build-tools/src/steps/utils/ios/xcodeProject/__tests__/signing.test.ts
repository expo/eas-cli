import { vol } from 'memfs';
import path from 'path';

import { getBuildConfigurations, openXcodeProject } from '../pbxproj';
import {
  SigningBuildSettings,
  TargetSigning,
  assertSigningBuildSettingsAreEffective,
  writeSigningBuildSettingsAsync,
} from '../signing';

const originalFs = jest.requireActual('fs');

const xcodeprojPath = '/project/App.xcodeproj';
const NATIVE_APP_TARGET_ID = '2870BA69F546F142D461562E';
const MULTITARGET_APP_TARGET_ID = '13B07F861A680F5B00A75B9A';
const SIGNING_BUILD_SETTINGS: SigningBuildSettings = {
  PROVISIONING_PROFILE_SPECIFIER: 'App Store Profile',
  DEVELOPMENT_TEAM: 'ABCDE12345',
  CODE_SIGN_IDENTITY: 'iPhone Distribution',
  CODE_SIGN_STYLE: 'Manual',
};
const NATIVE_APP_SIGNING: TargetSigning = {
  target: { id: NATIVE_APP_TARGET_ID, name: 'NativeApp' },
  buildSettings: SIGNING_BUILD_SETTINGS,
};

function writeProjectFile(contents: string): void {
  vol.fromJSON({ [`${xcodeprojPath}/project.pbxproj`]: contents });
}

function readFixture(relativePath: string): string {
  return originalFs.readFileSync(path.join(__dirname, relativePath), 'utf-8');
}

function readBuildSettings(targetId: string, buildConfiguration: string): Record<string, unknown> {
  return getBuildConfigurations(openXcodeProject(xcodeprojPath), targetId).find(
    ({ name }) => name === buildConfiguration
  )!.buildSettings;
}

afterEach(() => {
  vol.reset();
});

describe(writeSigningBuildSettingsAsync, () => {
  it('writes the settings on the build configuration and removes their conditional variants', async () => {
    writeProjectFile(
      readFixture('fixtures/native-app.pbxproj').replaceAll(
        'PRODUCT_BUNDLE_IDENTIFIER = dev.expo.nativeapp;',
        [
          'PRODUCT_BUNDLE_IDENTIFIER = dev.expo.nativeapp;',
          '"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "iPhone Developer";',
          '"CODE_SIGN_STYLE[sdk=iphoneos*]" = Automatic;',
          '"DEVELOPMENT_TEAM[sdk=iphoneos*]" = OLDTEAM123;',
          '"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]" = "Old Profile";',
          '"OTHER_LDFLAGS[sdk=iphoneos*]" = "-ObjC";',
        ].join('\n')
      )
    );

    await writeSigningBuildSettingsAsync({
      xcodeprojPath,
      buildConfiguration: 'Release',
      targetSignings: [NATIVE_APP_SIGNING],
    });

    const releaseBuildSettings = readBuildSettings(NATIVE_APP_TARGET_ID, 'Release');
    expect(releaseBuildSettings).toMatchObject({
      PROVISIONING_PROFILE_SPECIFIER: '"App Store Profile"',
      DEVELOPMENT_TEAM: '"ABCDE12345"',
      CODE_SIGN_IDENTITY: '"iPhone Distribution"',
      CODE_SIGN_STYLE: '"Manual"',
    });
    expect(Object.keys(releaseBuildSettings).filter(key => key.includes('[sdk='))).toEqual([
      '"OTHER_LDFLAGS[sdk=iphoneos*]"',
    ]);
    expect(readBuildSettings(NATIVE_APP_TARGET_ID, 'Debug')).toMatchObject({
      CODE_SIGN_STYLE: 'Automatic',
      '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': '"iPhone Developer"',
      '"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]"': '"Old Profile"',
    });
  });

  it('escapes double quotes and backslashes in the values', async () => {
    writeProjectFile(readFixture('fixtures/native-app.pbxproj'));

    await writeSigningBuildSettingsAsync({
      xcodeprojPath,
      buildConfiguration: 'Release',
      targetSignings: [
        {
          ...NATIVE_APP_SIGNING,
          buildSettings: {
            ...SIGNING_BUILD_SETTINGS,
            PROVISIONING_PROFILE_SPECIFIER: 'App "Ad Hoc" Profile \\ 1',
          },
        },
      ],
    });

    expect(readBuildSettings(NATIVE_APP_TARGET_ID, 'Release')).toMatchObject({
      PROVISIONING_PROFILE_SPECIFIER: '"App \\"Ad Hoc\\" Profile \\\\ 1"',
    });
  });

  it('writes the settings when the project has no attributes', async () => {
    writeProjectFile(
      readFixture('fixtures/native-app.pbxproj').replace(/\t\t\tattributes = \{[^}]*\};\n/, '')
    );

    await writeSigningBuildSettingsAsync({
      xcodeprojPath,
      buildConfiguration: 'Release',
      targetSignings: [NATIVE_APP_SIGNING],
    });

    expect(readBuildSettings(NATIVE_APP_TARGET_ID, 'Release')).toMatchObject({
      CODE_SIGN_STYLE: '"Manual"',
    });
  });

  it('sets manual signing in the target attributes when the project has target attributes', async () => {
    writeProjectFile(readFixture('../../__tests__/fixtures/multitarget-project.pbxproj'));

    await writeSigningBuildSettingsAsync({
      xcodeprojPath,
      buildConfiguration: 'Release',
      targetSignings: [
        {
          target: { id: MULTITARGET_APP_TARGET_ID, name: 'multitarget' },
          buildSettings: SIGNING_BUILD_SETTINGS,
        },
      ],
    });

    expect(
      openXcodeProject(xcodeprojPath).getFirstProject().firstProject.attributes.TargetAttributes[
        MULTITARGET_APP_TARGET_ID
      ]
    ).toMatchObject({ DevelopmentTeam: '"ABCDE12345"', ProvisioningStyle: '"Manual"' });
  });
});

describe(assertSigningBuildSettingsAreEffective, () => {
  function assertWithEffectiveBuildSettings(buildSettings: Record<string, string>): void {
    assertSigningBuildSettingsAreEffective({
      buildConfiguration: 'Release',
      targetSignings: [NATIVE_APP_SIGNING],
      effectiveBuildSettingsByTargetName: { NativeApp: buildSettings },
    });
  }

  it('passes when Xcode resolves every setting to the written value', () => {
    expect(() => assertWithEffectiveBuildSettings(SIGNING_BUILD_SETTINGS)).not.toThrow();
  });

  it('fails when Xcode resolves a setting to another value', () => {
    expect(() =>
      assertWithEffectiveBuildSettings({
        ...SIGNING_BUILD_SETTINGS,
        PROVISIONING_PROFILE_SPECIFIER: 'Profile From Xcconfig',
      })
    ).toThrow(
      expect.objectContaining({
        errorCode: 'NATIVE_XCODE_SIGNING_SETTING_OVERRIDDEN',
        message: expect.stringMatching(
          /PROVISIONING_PROFILE_SPECIFIER to "App Store Profile" on the target "NativeApp".*"Profile From Xcconfig"/
        ),
      })
    );
  });
});
