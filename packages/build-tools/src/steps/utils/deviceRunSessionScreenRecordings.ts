import { SystemError } from '@expo/eas-build-job';
import type { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import type { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import limitFactory from 'promise-limit';
import { z } from 'zod';

import { type CustomBuildContext } from '../../customBuildContext';
import { Sentry } from '../../sentry';
import { formatBytes } from '../../utils/artifacts';
import { uploadDeviceRunSessionArtifactAsync } from './deviceRunSessionArtifacts';

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
  status: z.string().optional(),
  error: z.string().optional(),
});

const UnlistedRecordingManifestSchema = z.object({
  udid: z.string(),
  deviceName: z.string(),
  runtimeDisplayName: z.string(),
  status: z.enum(['recording', 'failed', 'complete']),
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

export function parseDeviceScreenRecordings(input: unknown): z.infer<typeof RecordingsSchema> {
  const result = RecordingsSchema.safeParse(input);
  if (!result.success) {
    throw new SystemError('Invalid device screen recordings input.', {
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * A Hub that was killed never lists its recording, even one it had already completed at the
 * duration limit. session.json is at "recording" or "failed" with a fragmented .partial that plays
 * up to its last keyframe, or at "complete" with the finished file. Return the ones ffprobe can read.
 */
export async function findUnlistedDeviceScreenRecordingsAsync({
  root,
  env,
  logger,
}: {
  root: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<z.infer<typeof RecordingsSchema>> {
  const found: z.infer<typeof RecordingsSchema> = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = path.join(root, entry.name);
    const manifest = UnlistedRecordingManifestSchema.safeParse(
      await readFile(path.join(directory, 'session.json'), 'utf-8')
        .then(text => JSON.parse(text))
        .catch(() => null)
    );
    if (!manifest.success || path.basename(manifest.data.recording) !== manifest.data.recording) {
      continue;
    }
    const file = path.join(directory, manifest.data.recording);
    const probe = await asyncResult(
      spawn(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        {
          env,
          stdio: 'pipe',
        }
      )
    );
    if (!probe.ok || !(Number(probe.value.stdout.trim()) > 0)) {
      logger.warn(`Unlisted recording ${file} does not decode; skipping it.`);
      continue;
    }
    const { udid, deviceName, runtimeDisplayName } = manifest.data;
    found.push({ udid, deviceName, runtimeDisplayName, directory });
  }
  return found;
}

export async function uploadDeviceRunSessionScreenRecordingsAsync(
  ctx: CustomBuildContext,
  {
    logger,
    deviceRunSessionId,
    recordings,
  }: {
    logger: bunyan;
    deviceRunSessionId: string;
    recordings: z.infer<typeof RecordingsSchema>;
  }
): Promise<boolean> {
  if (recordings.length === 0) {
    logger.info('No device screen recordings found; skipping uploads.');
    return true;
  }

  const limit = limitFactory(5);
  const uploaded = await Promise.all(
    recordings.map(recording =>
      limit(async () => {
        try {
          const metadata = RecordingManifestSchema.parse(
            JSON.parse(await readFile(path.join(recording.directory, 'session.json'), 'utf-8'))
          );
          if (path.basename(metadata.recording) !== metadata.recording) {
            throw new Error('Recording filename must not contain a directory.');
          }
          const startedAt = recordingStartTimeFormatter.format(
            new Date(metadata.firstFrameWallClock.iso8601)
          );
          const partial = metadata.status !== undefined && metadata.status !== 'complete';
          const shortUdid = `${recording.udid.slice(0, 8)}-…`;
          const displayName = `${recording.deviceName} screen recording (${shortUdid}, started at ${startedAt}${partial ? ', partial' : ''})`;
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
              ...(partial
                ? {
                    partial: true,
                    partialReason:
                      metadata.error ??
                      'The Device Hub stopped before it could finalize the recording.',
                  }
                : {}),
            },
            size,
            stream: createReadStream(recordingPath),
            reopenStream: () => createReadStream(recordingPath),
          });
          return true;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          Sentry.capture('Could not upload device screen recording', error);
          logger.warn(
            { err: error },
            `Could not upload screen recording for ${recording.deviceName}.`
          );
          return false;
        }
      })
    )
  );
  return uploaded.every(Boolean);
}
