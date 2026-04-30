import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import path from 'path';

import { parseAndReportXcactivitylog } from '../utils/ios/xcactivitylog';

export function parseXcactivitylogFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'parse_xcactivitylog',
    name: 'Analyze build performance',
    __metricsId: 'eas/parse_xcactivitylog',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'derived_data_path',
        required: false,
        defaultValue: 'ios/build',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'workspace_path',
        required: false,
        defaultValue: 'ios',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'xclogparser_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { inputs, env }) => {
      const derivedDataPath = inputs.derived_data_path.value as string;
      const workspacePath = inputs.workspace_path.value as string;
      const version = inputs.xclogparser_version.value as string | undefined;

      await parseAndReportXcactivitylog({
        derivedDataPath: path.resolve(stepCtx.workingDirectory, derivedDataPath),
        workspacePath: path.resolve(stepCtx.workingDirectory, workspacePath),
        xclogparserVersion: version,
        logger: stepCtx.logger,
        proxyBaseUrl: env.EAS_BUILD_COCOAPODS_CACHE_URL,
      });
    },
  });
}
