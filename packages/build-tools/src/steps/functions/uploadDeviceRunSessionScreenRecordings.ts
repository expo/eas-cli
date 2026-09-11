import { SystemError } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import {
  BuildFunction,
  BuildRuntimePlatform,
  type BuildStepEnv,
  BuildStepInput,
  BuildStepInputValueTypeName,
} from '@expo/steps';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import limitFactory from 'promise-limit';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { formatBytes } from '../../utils/artifacts';
import { uploadDeviceRunSessionArtifactAsync } from '../utils/deviceRunSessionArtifacts';
import { getDeviceRunSessionIdOrThrow } from '../utils/remoteDeviceRunSession';

const RecordingsSchema = z.array(
  z.object({
    udid: z.string(),
    deviceName: z.string(),
    runtimeDisplayName: z.string(),
    directory: z.string(),
  })
);

const RecordingManifestSchema = z.object({
  firstFrameWallClock: z.object({
    iso8601: z.string(),
  }),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  recording: z.string(),
});

const recordingStartTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

export function createUploadDeviceRunSessionScreenRecordingsBuildFunction(
  ctx: CustomBuildContext
): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'upload_device_run_session_screen_recordings',
    name: 'Upload device run session screen recordings',
    __metricsId: 'eas/upload_device_run_session_screen_recordings',
    supportedRuntimePlatforms: [BuildRuntimePlatform.DARWIN, BuildRuntimePlatform.LINUX],
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'recordings_json',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.JSON,
      }),
    ],
    fn: async ({ logger }, { env, inputs }) => {
      await uploadDeviceRunSessionScreenRecordingsAsync(ctx, {
        logger,
        env,
        recordings: inputs.recordings_json.value ?? [],
      });
    },
  });
}

export async function uploadDeviceRunSessionScreenRecordingsAsync(
  ctx: CustomBuildContext,
  { logger, env, recordings: input }: { logger: bunyan; env: BuildStepEnv; recordings: unknown }
): Promise<void> {
  const result = RecordingsSchema.safeParse(input);
  if (!result.success) {
    throw new SystemError('Invalid device screen recordings input.', {
      cause: result.error,
    });
  }
  const recordings = result.data;
  if (recordings.length === 0) {
    logger.info('No device screen recordings found; skipping uploads.');
    return;
  }

  const deviceRunSessionId = getDeviceRunSessionIdOrThrow(env);

  const limit = limitFactory(5);
  await Promise.all(
    recordings.map(recording =>
      limit(async () => {
        try {
          const metadata = RecordingManifestSchema.parse(
            JSON.parse(await readFile(path.join(recording.directory, 'session.json'), 'utf-8'))
          );
          const startedAt = recordingStartTimeFormatter.format(
            new Date(metadata.firstFrameWallClock.iso8601)
          );
          const shortUdid = `${recording.udid.slice(0, 8)}-…`;
          const displayName = `${recording.deviceName} screen recording (${shortUdid}, started at ${startedAt})`;
          const recordingPath = path.join(recording.directory, metadata.recording);
          const { size } = await stat(recordingPath);
          const recordingId = path.basename(recording.directory);
          logger.info(
            `Uploading screen recording for ${recording.deviceName} (${formatBytes(size)}).`
          );
          await uploadDeviceRunSessionArtifactAsync(ctx, {
            deviceRunSessionId,
            artifactId: recordingId,
            name: displayName,
            filename: `${recordingId}.mp4`,
            kind: 'screen-recording',
            metadata: {
              __eas_type: 'screen-recording',
              __eas_screen_recording: '1',
              udid: recording.udid,
              deviceName: recording.deviceName,
              runtimeDisplayName: recording.runtimeDisplayName,
              firstFrameAt: metadata.firstFrameWallClock.iso8601,
              width: metadata.width,
              height: metadata.height,
            },
            size,
            stream: createReadStream(recordingPath),
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          Sentry.capture('Could not upload device screen recording', error);
          logger.warn(
            { err: error },
            `Could not upload screen recording for ${recording.deviceName}.`
          );
        }
      })
    )
  );
}
