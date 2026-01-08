import path from 'path';
import assert from 'assert';

import { Platform } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { resolveGradleCommand, runGradleCommand } from '../utils/android/gradle';
import { BuildStatusText, BuildStepOutputName } from '../utils/slackMessageDynamicFields';

export function runGradleFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'run_gradle',
    name: 'Run gradle',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'command',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'resolved_eas_update_runtime_version',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
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
    fn: async (stepCtx, { env, inputs, outputs }) => {
      outputs[BuildStepOutputName.STATUS_TEXT].set(BuildStatusText.STARTED);
      assert(stepCtx.global.staticContext.job, 'Job is required');
      assert(
        stepCtx.global.staticContext.job.platform === Platform.ANDROID,
        'This function is only available when building for Android'
      );
      const command = resolveGradleCommand(
        stepCtx.global.staticContext.job,
        inputs.command.value as string | undefined
      );

      const resolvedEASUpdateRuntimeVersion = inputs.resolved_eas_update_runtime_version.value as
        | string
        | undefined;
      try {
        await runGradleCommand({
          logger: stepCtx.logger,
          gradleCommand: command,
          androidDir: path.join(stepCtx.workingDirectory, 'android'),
          env,
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
