import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';
import path from 'node:path';

import { InstalledIosCredentialsZ } from '../../../utils/ios/credentials/installedCredentials';
import { DistributionType } from '../../../utils/ios/credentials/provisioningProfile';
import { readBuildSettingsByTargetNameAsync } from '../../../utils/ios/xcodeProject/buildSettings';
import { XcodeTargetsWithBundleIdentifierZ } from '../../../utils/ios/xcodeProject/pbxproj';
import {
  assertSigningBuildSettingsAreEffective,
  writeSigningBuildSettingsAsync,
} from '../../../utils/ios/xcodeProject/signing';

export function createConfigureXcodeSigningBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'configure_xcode_signing',
    name: 'Configure Xcode signing',
    __metricsId: 'eas/configure_xcode_signing',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'xcodeproj_path',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'build_configuration',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'targets',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'installed_credentials',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    ],
    outputProviders: [BuildStepOutput.createProvider({ id: 'entitlements_path', required: false })],
    fn: async ({ logger }, { inputs, outputs, env }) => {
      const xcodeprojPath = inputs.xcodeproj_path.value as string;
      const buildConfiguration = inputs.build_configuration.value as string;
      const targets = XcodeTargetsWithBundleIdentifierZ.parse(inputs.targets.value);
      const { distributionType, profileByTargetName } = InstalledIosCredentialsZ.parse(
        inputs.installed_credentials.value
      );

      const targetSignings = targets.map(target => {
        const profile = profileByTargetName[target.name];
        logger.info(
          `Assigning provisioning profile '${profile.profileName}' (Apple Team ID: ${profile.teamId}) to target '${target.name}'`
        );
        return {
          target,
          buildSettings: {
            PROVISIONING_PROFILE_SPECIFIER: profile.profileName,
            DEVELOPMENT_TEAM: profile.teamId,
            CODE_SIGN_IDENTITY:
              distributionType === DistributionType.DEVELOPMENT
                ? profile.certificateCommonName
                : 'iPhone Distribution',
            CODE_SIGN_STYLE: 'Manual',
          },
        };
      });
      await writeSigningBuildSettingsAsync({ xcodeprojPath, buildConfiguration, targetSignings });
      const effectiveBuildSettingsByTargetName = await readBuildSettingsByTargetNameAsync({
        xcodeprojPath,
        targetNames: targets.map(({ name }) => name),
        buildConfiguration,
        env,
        logger,
      });
      assertSigningBuildSettingsAreEffective({
        buildConfiguration,
        targetSignings,
        effectiveBuildSettingsByTargetName,
      });

      const [applicationTarget] = targets;
      const { SRCROOT, CODE_SIGN_ENTITLEMENTS } =
        effectiveBuildSettingsByTargetName[applicationTarget.name];
      outputs.entitlements_path.set(
        CODE_SIGN_ENTITLEMENTS ? path.resolve(SRCROOT, CODE_SIGN_ENTITLEMENTS) : undefined
      );
    },
  });
}
