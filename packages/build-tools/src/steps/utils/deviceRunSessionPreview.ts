import { type bunyan } from '@expo/logger';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { graphql } from 'gql.tada';
import fetch from 'node-fetch';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../customBuildContext';

const PREVIEW_INTERVAL_MS = 60_000;
const UPLOAD_SESSION_DURATION_MS = 110 * 60_000;
const MAX_PREVIEW_SIZE_BYTES = 5 * 1024 * 1024;
const CREATE_PREVIEW_UPLOAD_SESSION_MUTATION = graphql(`
  mutation CreateDeviceRunSessionPreviewUploadSession($deviceRunSessionId: ID!) {
    deviceRunSession {
      createPreviewUploadSession(deviceRunSessionId: $deviceRunSessionId) {
        uploadSession {
          url
          headers
        }
      }
    }
  }
`);

export function startDeviceRunSessionPreview({
  ctx,
  deviceRunSessionId,
  captureAsync,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  captureAsync: (signal: AbortSignal) => Promise<Buffer>;
  logger: bunyan;
}): { stopAsync: () => Promise<void> } {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let uploadSession: { url: string; headers: Record<string, string>; renewAt: number } | undefined;
  let pending: Promise<void>;

  const uploadAsync = async (): Promise<void> => {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]);
    try {
      const image = await captureAsync(signal);
      if (controller.signal.aborted) {
        return;
      }
      if (image.length === 0 || image.length > MAX_PREVIEW_SIZE_BYTES) {
        throw new Error('Session preview is empty or exceeds the 5 MiB upload limit.');
      }
      if (!uploadSession || Date.now() >= uploadSession.renewAt) {
        const result = await ctx.graphqlClient
          .mutation(
            CREATE_PREVIEW_UPLOAD_SESSION_MUTATION,
            { deviceRunSessionId },
            { fetchOptions: { signal } }
          )
          .toPromise();
        if (result.error) {
          throw result.error;
        }
        const session = result.data?.deviceRunSession.createPreviewUploadSession.uploadSession;
        if (!session) {
          throw new Error('No session preview upload URL was returned.');
        }
        uploadSession = {
          url: session.url,
          headers: session.headers as Record<string, string>,
          renewAt: Date.now() + UPLOAD_SESSION_DURATION_MS,
        };
      }
      if (controller.signal.aborted) {
        return;
      }
      const response = await fetch(uploadSession.url, {
        method: 'PUT',
        headers: uploadSession.headers,
        body: image,
        signal,
        timeout: 30_000,
      });
      if (!response.ok) {
        uploadSession = undefined;
        throw new Error(`Session preview upload failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        logger.warn({ err }, 'Could not refresh the session preview; retrying in 60 seconds.');
      }
    }
  };
  const tick = (): void => {
    pending = uploadAsync().finally(() => {
      if (!controller.signal.aborted) {
        timer = setTimeout(tick, PREVIEW_INTERVAL_MS);
        timer.unref();
      }
    });
  };
  tick();
  return {
    stopAsync: async () => {
      controller.abort();
      clearTimeout(timer);
      await pending;
    },
  };
}

export async function captureDeviceRunSessionPreviewAsync({
  runtimePlatform,
  device,
  env,
  signal,
}: {
  runtimePlatform: BuildRuntimePlatform;
  device: string;
  env: BuildStepEnv;
  signal: AbortSignal;
}): Promise<Buffer> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'session-preview-'));
  try {
    const screenshot = path.join(directory, 'screen.png');
    const preview = path.join(directory, 'preview.webp');
    const options = { env, signal, timeout: 30_000, stdio: 'pipe' as const };
    if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
      await spawn('xcrun', ['simctl', 'io', device, 'screenshot', screenshot], options);
    } else {
      let serial = device;
      // expo-device-hub's readiness endpoint currently reports a placeholder instead of a serial.
      if (serial === 'no-device-id') {
        const result = await spawn('adb', ['devices'], options);
        const devices = result.stdout
          .split('\n')
          .map(line => line.trim().split(/\s+/))
          .filter(([, status]) => status === 'device');
        if (devices.length !== 1) {
          throw new Error('Expected exactly one connected Android device for the session preview.');
        }
        serial = devices[0][0];
      }
      const capture = spawn('adb', ['-s', serial, 'exec-out', 'screencap', '-p'], options);
      // Preserve binary PNG output instead of spawn-async's UTF-8 stdout conversion.
      await Promise.all([
        capture,
        pipeline(capture.child.stdout!, createWriteStream(screenshot), { signal }),
      ]);
    }
    await spawn(
      'ffmpeg',
      [
        '-nostdin',
        '-y',
        '-i',
        screenshot,
        '-vf',
        'scale=320:320:force_original_aspect_ratio=decrease',
        '-frames:v',
        '1',
        '-c:v',
        'libwebp',
        '-quality',
        '70',
        preview,
      ],
      options
    );
    return await readFile(preview);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
