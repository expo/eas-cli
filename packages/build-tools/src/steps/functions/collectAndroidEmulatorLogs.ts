import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';

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
    fn: async ({ logger, global }, { env }) => {
      try {
        await collectAndroidEmulatorLogsAsync(ctx, {
          global,
          deviceRunSessionId: getDeviceRunSessionIdOrThrow(env),
          logger,
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
