import type { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { type CustomBuildContext } from '../../customBuildContext';
import { IosSimulatorRecordingUtils } from './IosSimulatorRecordingUtils';
import { type DeviceSessionServer } from './deviceSessionHost';
import { readLocalEgressHandoffAsync } from './localEgress';
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
    turnArgs: fetchWebPreviewTurnArgsAsync(ctx, { logger }),
    // Set by prepare-tools, which the host runs before it installs the app.
    get preinstalledApp() {
      return warm.preinstalledExpoGo;
    },
    requiresPreviewRetirement: true,
    stopAsync,
    async startAsync({ command, args, env, signal }) {
      try {
        const localEgress = await readLocalEgressHandoffAsync();
        const policyArgs = [localEgress ? '--enable' : '--disable', 'egressGuard'];
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
        await spawn(
          command,
          [...args, '--single-device', udid, '--adopt', ...policyArgs, ...recordingArgs],
          {
            env,
            stdio: 'pipe',
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          }
        );
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
 * Runs an iOS session on the warm Simulator when the job can claim it, else cold. After an
 * adoption failure, it stops warmup and runs the session cold.
 */
export async function runOnWarmIosSimulatorAsync<T>(
  claim: Parameters<typeof tryClaimWarmIosSessionAsync>[0],
  run: (warm?: WarmIosSession) => Promise<T>
): Promise<T> {
  const warm = await tryClaimWarmIosSessionAsync(claim);
  if (!warm) {
    return await run(undefined);
  }
  try {
    return await run(warm);
  } catch (error) {
    if (!(error instanceof WarmSessionAdoptionError)) {
      throw error;
    }
    claim.logger.warn('Could not adopt the warm Simulator; starting a cold Simulator.');
    await warm.process.stopAsync();
    claim.signal?.throwIfAborted();
    return await run(undefined);
  }
}
