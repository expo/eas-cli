import type { bunyan } from '@expo/logger';
import spawn from '@expo/turtle-spawn';

import { type CustomBuildContext } from '../../customBuildContext';
import { IosSimulatorRecordingUtils } from './IosSimulatorRecordingUtils';
import { type DeviceSessionServer } from './deviceSessionHost';
import { fetchWebPreviewTurnArgsAsync } from './remoteDeviceRunSession';
import { type WarmIosSession } from './warmIosSession';

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
