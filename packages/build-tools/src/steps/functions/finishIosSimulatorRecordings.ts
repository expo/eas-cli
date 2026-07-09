import { BuildFunction, BuildRuntimePlatform } from '@expo/steps';
import fs from 'fs/promises';

import { type CustomBuildContext } from '../../customBuildContext';
import { finishIosSimulatorRecordingsAsync } from '../utils/iosSimulatorRecordings';
import limitFactory from 'promise-limit';
import { formatBytes } from '../../utils/artifacts';
import { uploadDeviceRunSessionArtifactAsync } from '../utils/deviceRunSessionArtifacts';
import { createReadStream } from 'fs-extra';
import { Sentry } from '../..';

export function createFinishIosSimulatorRecordingsBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'finish_ios_simulator_recordings',
    name: 'Finish iOS Simulator recordings',
    __metricsId: 'eas/finish_ios_simulator_recordings',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN],
    fn: async ({ logger }, { env }) => {
      const recordings = await finishIosSimulatorRecordingsAsync({ logger });

      const deviceRunSessionId = env.DEVICE_RUN_SESSION_ID;
      if (!deviceRunSessionId) {
        logger.info('No device run session ID found; skipping screen recording uploads.');
        return;
      }

      const limit = limitFactory(5);

      await Promise.all(
        recordings.map(recording =>
          limit(async () => {
            try {
              if (!recording.output) {
                logger.warn(
                  { recordSimOutput: recording.getOutput() },
                  `Skipping screen recording upload for ${recording.displayName}; recording file is missing.`
                );
                return;
              }

              const { size } = await fs.stat(recording.output.path);
              logger.info(
                `Uploading screen recording for ${recording.displayName} (${formatBytes(size)}).`
              );
              await uploadDeviceRunSessionArtifactAsync(ctx, {
                deviceRunSessionId,
                artifactId: recording.id,
                name: `iOS Simulator Recording - ${recording.displayName}`,
                filename: `${recording.id}.mp4`,
                kind: 'screen-recording',
                metadata: {
                  udid: recording.udid,
                  firstFrameAt: recording.output.metadata.firstFrameWallClock.iso8601,
                },
                size,
                stream: createReadStream(recording.output.path),
              });
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              Sentry.capture('Could not upload iOS Simulator screen recording', error);
              logger.warn(
                { err: error, recordSimOutput: recording.getOutput() },
                `Could not upload screen recording for ${recording.displayName}.`
              );
            }
          })
        )
      );
    },
  });
}
