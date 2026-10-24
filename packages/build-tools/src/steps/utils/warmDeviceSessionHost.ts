import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { IosSimulatorRecordingUtils } from './IosSimulatorRecordingUtils';
import {
  type DeviceSessionHost,
  type DeviceSessionHostOptions,
  type DeviceSessionServer,
  startDeviceSessionHostAsync,
} from './deviceSessionHost';
import { withDeviceRunSessionTimeoutAsync } from './deviceRunSessionTimeout';
import { type WarmIosSession } from './warmIosSession';
import { fetchWebPreviewTurnArgsAsync, stopDetachedProcessAsync } from './remoteDeviceRunSession';

/** Only CLI adoption failures are eligible for a cold retry, before any app actions run. */
export class WarmSessionAdoptionError extends Error {
  constructor() {
    // Package-manager errors can contain the whole command, including fresh TURN credentials.
    super('Could not configure the warm serve-sim session for this job.');
    this.name = 'WarmSessionAdoptionError';
  }
}

/** The caller owns failure cleanup and may retry cold only after the saved worker stops. */
export async function startWarmDeviceSessionHostAsync(
  ctx: CustomBuildContext,
  options: DeviceSessionHostOptions,
  warm: WarmIosSession,
  startup?: Partial<Pick<DeviceSessionServer, 'turnArgs'>>
): Promise<DeviceSessionHost> {
  if (options.runtimePlatform !== BuildRuntimePlatform.DARWIN || !options.iosSimulatorUdid) {
    throw new Error(
      'A warm session requires macOS and the UDID of the iOS Simulator being handed over.'
    );
  }
  return await startDeviceSessionHostAsync(
    ctx,
    options,
    createWarmDeviceSessionServer(ctx, options.logger, warm, startup)
  );
}

/** Adopts the serve-sim prepared before the job instead of launching one. */
function createWarmDeviceSessionServer(
  ctx: CustomBuildContext,
  logger: bunyan,
  warm: WarmIosSession,
  startup?: Partial<Pick<DeviceSessionServer, 'turnArgs'>>
): DeviceSessionServer {
  let recording: Awaited<
    ReturnType<typeof IosSimulatorRecordingUtils.prepareAdoptedRecordingAsync>
  >;
  async function stopSessionAsync(): Promise<void> {
    try {
      await recording?.finishAsync();
    } catch (err) {
      // Only a failed stop may reject: the host treats a rejection as a still-running server.
      logger.warn(
        { err },
        'Could not finish the warm Simulator video recording; complete footage is not confirmed.'
      );
    }
    await warm.process.stopAsync();
  }
  return {
    port: warm.serveSim.port,
    // Warm startup can fetch TURN while claiming the device.
    turnArgs: startup?.turnArgs ?? fetchWebPreviewTurnArgsAsync(ctx, { logger }),
    simulatorPrepared: true,
    requiresPreviewRetirement: true,
    stopAsync: stopSessionAsync,
    async startAsync({ command, args, env, signal }) {
      let adoption: ReturnType<typeof spawn> | undefined;
      try {
        recording = await IosSimulatorRecordingUtils.prepareAdoptedRecordingAsync({
          udid: warm.device.udid,
          deviceName: warm.device.name,
          serverToken: warm.serveSim.token,
          recordingUrl: `http://127.0.0.1:${warm.serveSim.port}/helper/${encodeURIComponent(warm.device.udid)}/recording/video`,
        });
        try {
          await withDeviceRunSessionTimeoutAsync(
            { name: 'Warm session adoption', timeoutMs: 60_000, signal },
            async adoptionSignal => {
              adoption = spawn(
                command,
                [
                  ...args,
                  '--adopt',
                  ...(recording
                    ? [
                        '--recording-output',
                        recording.output,
                        '--recording-id',
                        recording.recordingId,
                      ]
                    : []),
                ],
                {
                  env,
                  detached: true,
                  stdio: 'pipe',
                  signal: adoptionSignal,
                }
              );
              const result = await adoption;
              adoptionSignal.throwIfAborted();
              if (recording) {
                z.object({
                  recording: z.object({
                    output: z.literal(recording.output),
                    recordingId: z.literal(recording.recordingId),
                  }),
                }).parse(JSON.parse(result.stdout));
                // CLI success confirms native writer start; never infer it from generic active status.
              }
            }
          );
        } finally {
          await stopDetachedProcessAsync(adoption?.child?.pid, 1_000);
        }
      } catch {
        signal?.throwIfAborted();
        throw new WarmSessionAdoptionError();
      }
      return { ...warm.process, stopAsync: stopSessionAsync };
    },
  };
}
