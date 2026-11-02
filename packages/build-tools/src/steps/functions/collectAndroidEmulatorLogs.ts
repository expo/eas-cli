import {
  BuildFunction,
  BuildRuntimePlatform,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { collectAndroidEmulatorLogsAsync } from '../utils/androidEmulatorLogs';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';

export function createCollectAndroidEmulatorLogsBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'collect_android_emulator_logs',
    name: 'Collect Android emulator logs',
    __metricsId: 'eas/collect_android_emulator_logs',
    supportedRuntimePlatforms: [BuildRuntimePlatform.LINUX],
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'sources',
        required: false,
        defaultValue: ['emulator-output'],
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    ],
    fn: async ({ logger, global }, { inputs, env }) => {
      try {
        await collectAndroidEmulatorLogsAsync(ctx, {
          global,
          deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
          logger,
          sources: z
            .array(z.enum(['emulator-output', 'device-logcat']))
            .parse(inputs.sources.value),
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.capture('Could not collect Android emulator logs', error);
        logger.warn(
          { err: error },
          'Could not collect Android logs; the session result is unchanged.'
        );
      }
    },
  });
}
