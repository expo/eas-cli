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
        id: 'derived_data',
        required: false,
        defaultValue: 'ios/build',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'workspace',
        required: false,
        defaultValue: 'ios',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'xclogparser_version',
        required: false,
        defaultValue: 'v0.2.46',
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { inputs }) => {
      const derivedData = inputs.derived_data.value as string;
      const workspace = inputs.workspace.value as string;
      const version = inputs.xclogparser_version.value as string;

      await parseAndReportXcactivitylog({
        derivedDataPath: path.resolve(stepCtx.workingDirectory, derivedData),
        workspacePath: path.resolve(stepCtx.workingDirectory, workspace),
        xclogparserVersion: version,
        logger: stepCtx.logger,
      });
    },
  });
}
