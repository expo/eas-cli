import { Platform, Workflow } from '@expo/eas-build-job';
import {
  BuildFunction,
  BuildStepInput,
  BuildStepInputValueTypeName,
  BuildStepOutput,
} from '@expo/steps';

import { resolveRuntimeVersionForExpoUpdatesIfConfiguredAsync } from '../../utils/expoUpdates';
import { readAppConfig } from '../../utils/appConfig';

export function calculateEASUpdateRuntimeVersionFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'calculate_eas_update_runtime_version',
    name: 'Calculate EAS Update Runtime Version',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'platform',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'workflow',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    outputProviders: [
      BuildStepOutput.createProvider({
        id: 'resolved_eas_update_runtime_version',
        required: false,
      }),
    ],
    fn: async (stepCtx, { env, inputs, outputs }) => {
      const appConfig = readAppConfig({
        projectDir: stepCtx.workingDirectory,
        env: Object.keys(env).reduce(
          (acc, key) => {
            acc[key] = env[key] ?? '';
            return acc;
          },
          {} as Record<string, string>
        ),
        logger: stepCtx.logger,
        sdkVersion: stepCtx.global.staticContext.metadata?.sdkVersion,
      }).exp;

      const platform =
        (inputs.platform.value as Platform) ?? stepCtx.global.staticContext.job.platform;
      const workflow = (inputs.workflow.value as Workflow) ?? stepCtx.global.staticContext.job.type;

      if (![Platform.ANDROID, Platform.IOS].includes(platform)) {
        throw new Error(
          `Unsupported platform: ${platform}. Platform must be "${Platform.ANDROID}" or "${Platform.IOS}"`
        );
      }

      if (![Workflow.GENERIC, Workflow.MANAGED].includes(workflow)) {
        if (workflow === Workflow.UNKNOWN) {
          throw new Error(
            `Detected ${Workflow.UNKNOWN} workflow. Please make sure to run the eas/resolve_build_config step before running this step.`
          );
        }
        throw new Error(
          `Unsupported workflow: ${workflow}. Workflow must be "${Workflow.GENERIC}" or "${Workflow.MANAGED}"`
        );
      }

      const resolvedRuntimeVersion = await resolveRuntimeVersionForExpoUpdatesIfConfiguredAsync({
        cwd: stepCtx.workingDirectory,
        logger: stepCtx.logger,
        appConfig,
        platform,
        workflow,
        env,
      });
      if (resolvedRuntimeVersion) {
        outputs.resolved_eas_update_runtime_version.set(
          resolvedRuntimeVersion.runtimeVersion ?? undefined
        );
      } else {
        stepCtx.logger.info('Skipped because EAS Update is not configured');
      }
    },
  });
}
