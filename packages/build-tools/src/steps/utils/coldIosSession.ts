import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';

import type { CustomBuildContext } from '../../customBuildContext';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';
import { waitForWarmSimulatorCleanupAsync } from '../../utils/warmSimulatorCleanup';
import type { DeviceSessionServer } from './deviceSessionHost';
import {
  fetchWebPreviewTurnArgsAsync,
  findAvailablePortAsync,
  spawnDetached,
} from './remoteDeviceRunSession';

/** Creates the cold iOS server handle; start and setup run when the host calls them. */
export async function createColdIosSessionAsync(
  ctx: CustomBuildContext,
  {
    env,
    logger,
    iosSimulatorUdid,
  }: { env: BuildStepEnv; logger: bunyan; iosSimulatorUdid?: string }
): Promise<DeviceSessionServer> {
  const port = await findAvailablePortAsync();
  const turnArgs = await fetchWebPreviewTurnArgsAsync(ctx, { logger });
  return {
    port,
    turnArgs: Promise.resolve(turnArgs),
    requiresPreviewRetirement: false,
    async startAsync({ command, args, env, logger, signal, secrets, stopGracePeriodMs }) {
      // serve-sim boots the device, so warm Simulator cleanup must finish first.
      await waitForWarmSimulatorCleanupAsync(env, { signal });
      signal?.throwIfAborted();
      return spawnDetached({ command, args, env, logger, secrets, stopGracePeriodMs });
    },
    async setupSimulatorAsync({ signal, logger }) {
      try {
        await IosSimulatorUtils.disableApsdAsync({
          udid: iosSimulatorUdid as IosSimulatorUuid,
          env,
        });
      } catch (err) {
        signal.throwIfAborted();
        logger.warn({ err }, 'Failed to disable apsd in the Simulator.');
      }
      signal.throwIfAborted();
    },
    // A cold launch either returns its handle or starts no process.
    async stopAsync() {},
  };
}
