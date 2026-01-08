import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { runFastlaneGym } from '../utils/ios/fastlane';
import { BuildStatusText, BuildStepOutputName } from '../utils/slackMessageDynamicFields';

export function runFastlaneFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'run_fastlane',
    name: 'Run fastlane',
    outputProviders: [
      BuildStepOutput.createProvider({
        id: BuildStepOutputName.STATUS_TEXT,
        required: true,
      }),
      BuildStepOutput.createProvider({
        id: BuildStepOutputName.ERROR_TEXT,
        required: false,
      }),
    ],
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'resolved_eas_update_runtime_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepCtx, { env, outputs, inputs }) => {
      outputs[BuildStepOutputName.STATUS_TEXT].set(BuildStatusText.STARTED);
      const resolvedEASUpdateRuntimeVersion = inputs.resolved_eas_update_runtime_version.value as
        | string
        | undefined;
      try {
        await runFastlaneGym({
          workingDir: stepCtx.workingDirectory,
          env,
          logger: stepCtx.logger,
          buildLogsDirectory: stepCtx.global.buildLogsDirectory,
          ...(resolvedEASUpdateRuntimeVersion
            ? { extraEnv: { EXPO_UPDATES_FINGERPRINT_OVERRIDE: resolvedEASUpdateRuntimeVersion } }
            : null),
        });
      } catch (error) {
        outputs[BuildStepOutputName.STATUS_TEXT].set(BuildStatusText.ERROR);
        outputs[BuildStepOutputName.ERROR_TEXT].set((error as Error).toString());
        throw error;
      }
      outputs[BuildStepOutputName.STATUS_TEXT].set(BuildStatusText.SUCCESS);
    },
  });
}
