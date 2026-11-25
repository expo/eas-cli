import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import { z } from 'zod';

import { writeBuildNumberAsync } from '../../../utils/ios/xcodeProject/buildNumber';
import { XcodeTargetsWithBundleIdentifierZ } from '../../../utils/ios/xcodeProject/pbxproj';

export function createSetNativeXcodeBuildNumberBuildFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'set_native_xcode_build_number',
    name: 'Set the build number',
    __metricsId: 'eas/set_native_xcode_build_number',
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
        id: 'editable_info_plist_paths',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
      BuildStepInput.createProvider({
        id: 'build_number',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async ({ logger }, { inputs, env }) => {
      const buildNumber = inputs.build_number.value as string;
      const targets = XcodeTargetsWithBundleIdentifierZ.parse(inputs.targets.value);

      await writeBuildNumberAsync({
        xcodeprojPath: inputs.xcodeproj_path.value as string,
        buildConfiguration: inputs.build_configuration.value as string,
        targets,
        editableInfoPlistPaths: z.array(z.string()).parse(inputs.editable_info_plist_paths.value),
        buildNumber,
        env,
        logger,
      });
      logger.info(
        `Set the build number to ${buildNumber} for ${targets.map(({ name }) => `"${name}"`).join(', ')}.`
      );
    },
  });
}
