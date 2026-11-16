import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';

import type { CustomBuildContext } from '../../customBuildContext';
import { IosSimulatorUtils, type IosSimulatorUuid } from '../../utils/IosSimulatorUtils';
import { waitForWarmSimulatorCleanupAsync } from '../../utils/warmSimulatorCleanup';
import type { DeviceSessionServer } from './deviceSessionHost';
import { readLocalEgressHandoffAsync } from './localEgress';
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
      if (iosSimulatorUdid) {
        const localEgress = await readLocalEgressHandoffAsync();
        signal?.throwIfAborted();
        const udid = iosSimulatorUdid as IosSimulatorUuid;
        const device = await IosSimulatorUtils.getDeviceAsync({ udid, env });
        signal?.throwIfAborted();
        if (device && device.state !== 'Shutdown') {
          logger.info(`Shutting down ${udid} for resident egress startup.`);
          try {
            await spawn('xcrun', ['simctl', 'shutdown', udid], { env, logger, signal });
          } catch (error) {
            signal?.throwIfAborted();
            throw error;
          }
        }
        signal?.throwIfAborted();
        // Serve-sim owns boot, dead-enrollment reclamation and the native self-check.
        // The job makes an explicit choice even after a failed warm adoption.
        args = [...args, localEgress ? '--enable' : '--disable', 'egressGuard'];
      }
      return spawnDetached({ command, args, env, logger, secrets, stopGracePeriodMs });
    },
    async setupSimulatorAsync({ signal, logger }) {
      signal.throwIfAborted();
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
