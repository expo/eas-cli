import type { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { type CustomBuildContext } from '../../customBuildContext';
import { resolveSimulatorPackageVersionAsync } from '../../utils/simulatorPackageVersion';
import { stopWarmSimulatorAsync } from '../../utils/warmSimulator';
import { IosSimulatorRecordingUtils } from './IosSimulatorRecordingUtils';
import { type DeviceSessionServer } from './deviceSessionHost';
import { fetchWebPreviewTurnArgsAsync } from './remoteDeviceRunSession';
import { type WarmIosSession, tryClaimWarmIosSessionAsync } from './warmIosSession';

/** Adoption failed before app actions, so the caller can stop warmup and start cold. */
export class WarmSessionAdoptionError extends Error {
  constructor() {
    // The adoption command line includes TURN credentials, so the cause stays out of the message.
    super('Could not adopt the warm Simulator for this job.');
    this.name = 'WarmSessionAdoptionError';
  }
}

/** A session server that adopts the warm serve-sim for the job's device instead of launching one. */
export function createWarmDeviceSessionServer(
  ctx: CustomBuildContext,
  logger: bunyan,
  warm: WarmIosSession
): DeviceSessionServer {
  const { udid, name } = warm.device;
  async function stopAsync(): Promise<void> {
    await warm.process.stopAsync();
  }
  return {
    port: warm.server.port,
    serveSimVersion: warm.serveSimVersion,
    turnArgs: fetchWebPreviewTurnArgsAsync(ctx, { logger }),
    // Set by prepare-tools, which the host runs before it installs the app.
    get preinstalledApp() {
      return warm.preinstalledExpoGo;
    },
    requiresPreviewRetirement: true,
    stopAsync,
    async startAsync({ command, args, env, signal, secrets }) {
      warm.redactLogs?.(secrets);
      try {
        // serve-sim starts this job's recording when it adopts the device.
        const recording = await IosSimulatorRecordingUtils.prepareAdoptedRecordingAsync({
          udid,
          deviceName: name,
          serverToken: warm.server.token,
        });
        const recordingArgs = recording
          ? ['--recording-output', recording.output, '--recording-id', recording.recordingId]
          : [];
        const timeout = AbortSignal.timeout(360_000);
        await spawn(command, [...args, '--single-device', udid, '--adopt', ...recordingArgs], {
          env,
          stdio: 'pipe',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        await warm.prepareToolsAsync(signal);
      } catch {
        signal?.throwIfAborted();
        throw new WarmSessionAdoptionError();
      }
      return { ...warm.process, stopAsync };
    },
  };
}

/**
 * Runs an iOS session on the warm Simulator when the job can claim it, else cold. After a
 * callback failure, it stops warmup. Only an adoption failure can retry cold.
 */
export async function runOnWarmIosSimulatorAsync<T>(
  claim: Parameters<typeof tryClaimWarmIosSessionAsync>[0],
  run: (warm?: WarmIosSession, packageVersion?: string) => Promise<T>
): Promise<T> {
  let packageVersion = claim.packageVersion;
  if (packageVersion !== undefined && claim.env.EAS_USE_WARM_SIMULATOR === '1') {
    try {
      packageVersion = await resolveSimulatorPackageVersionAsync(
        claim.engine,
        packageVersion,
        claim
      );
    } catch (error) {
      try {
        await stopWarmSimulatorAsync(claim.env);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Could not stop warmup after version resolution failed.'
        );
      }
      throw error;
    }
  }
  const warm = await tryClaimWarmIosSessionAsync({ ...claim, packageVersion });
  if (!warm) {
    return await run(undefined, packageVersion);
  }
  try {
    return await run(warm, packageVersion);
  } catch (error) {
    try {
      await warm.process.stopAsync();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Could not stop the warm Simulator after failure.'
      );
    }
    if (!(error instanceof WarmSessionAdoptionError)) {
      throw error;
    }
    claim.logger.warn('Could not adopt the warm Simulator; starting a cold Simulator.');
    claim.signal?.throwIfAborted();
    return await run(undefined, packageVersion);
  }
}
