import { IOSConfig } from '@expo/config-plugins';
import { UserError } from '@expo/eas-build-job';
import assert from 'node:assert';
import fs from 'node:fs';

import { XcodeTarget, getBuildConfigurations, openXcodeProject } from './pbxproj';

const SIGNING_BUILD_SETTING_NAMES = [
  'PROVISIONING_PROFILE_SPECIFIER',
  'DEVELOPMENT_TEAM',
  'CODE_SIGN_IDENTITY',
  'CODE_SIGN_STYLE',
] as const;

export type SigningBuildSettings = Record<(typeof SIGNING_BUILD_SETTING_NAMES)[number], string>;

export interface TargetSigning {
  target: XcodeTarget;
  buildSettings: SigningBuildSettings;
}

export async function writeSigningBuildSettingsAsync({
  xcodeprojPath,
  buildConfiguration,
  targetSignings,
}: {
  xcodeprojPath: string;
  buildConfiguration: string;
  targetSignings: TargetSigning[];
}): Promise<void> {
  const project = openXcodeProject(xcodeprojPath);
  const targetAttributesById: Record<string, object> | undefined =
    project.getFirstProject().firstProject.attributes?.TargetAttributes;
  for (const { target, buildSettings } of targetSignings) {
    const targetBuildSettings = getBuildConfigurations(project, target.id).find(
      ({ name }) => IOSConfig.XcodeUtils.unquote(name) === buildConfiguration
    )?.buildSettings;
    assert(
      targetBuildSettings,
      `Target "${target.name}" has no build configuration named "${buildConfiguration}"`
    );
    for (const key of Object.keys(targetBuildSettings)) {
      if (isConditionalVariantOfSigningBuildSetting(key)) {
        delete targetBuildSettings[key];
      }
    }
    for (const name of SIGNING_BUILD_SETTING_NAMES) {
      targetBuildSettings[name] = quote(buildSettings[name]);
    }
    if (targetAttributesById) {
      targetAttributesById[target.id] = {
        ...targetAttributesById[target.id],
        DevelopmentTeam: quote(buildSettings.DEVELOPMENT_TEAM),
        ProvisioningStyle: quote(buildSettings.CODE_SIGN_STYLE),
      };
    }
  }
  await fs.promises.writeFile(project.filepath, project.writeSync());
}

export function assertSigningBuildSettingsAreEffective({
  buildConfiguration,
  targetSignings,
  effectiveBuildSettingsByTargetName,
}: {
  buildConfiguration: string;
  targetSignings: TargetSigning[];
  effectiveBuildSettingsByTargetName: Record<string, Record<string, string>>;
}): void {
  for (const { target, buildSettings } of targetSignings) {
    for (const name of SIGNING_BUILD_SETTING_NAMES) {
      const effectiveValue = effectiveBuildSettingsByTargetName[target.name]?.[name];
      if (effectiveValue !== buildSettings[name]) {
        throw new UserError(
          'NATIVE_XCODE_SIGNING_SETTING_OVERRIDDEN',
          `EAS set ${name} to "${buildSettings[name]}" on the target "${target.name}" for the build configuration "${buildConfiguration}", but Xcode resolves it to "${effectiveValue}". Another definition of ${name} overrides the one EAS wrote, so the target would be signed with the wrong credentials. Remove the other definition of ${name} for this target, for example one with a condition in an ".xcconfig" file.`
        );
      }
    }
  }
}

function isConditionalVariantOfSigningBuildSetting(buildSettingKey: string): boolean {
  const key = IOSConfig.XcodeUtils.unquote(buildSettingKey);
  return SIGNING_BUILD_SETTING_NAMES.some(name => key.startsWith(`${name}[`));
}

function quote(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`;
}
