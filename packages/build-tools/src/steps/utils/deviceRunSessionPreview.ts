import { type bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
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
const PREVIEW_MAX_DIMENSION = 320;
const PREVIEW_QUALITY = 70;
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

/**
 * node-fetch includes the request URL in its error messages, and this URL is a signed upload URL
 * that is valid for the whole session. Replace such errors with one that names only the failure.
 */
async function putPreviewAsync(
  uploadSession: { url: string; headers: Record<string, string> },
  { image, signal }: { image: Buffer; signal: AbortSignal }
): Promise<Awaited<ReturnType<typeof fetch>>> {
  try {
    return await fetch(uploadSession.url, {
      method: 'PUT',
      headers: uploadSession.headers,
      body: image,
      signal,
      timeout: 30_000,
    });
  } catch (err) {
    const { name, type, code } = err as { name?: unknown; type?: unknown; code?: unknown };
    const details = Object.entries({ name, type, code })
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    throw new Error(`Session preview upload request failed (${details || 'unknown error'}).`);
  }
}

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
  let uploadSession: { url: string; headers: Record<string, string> } | undefined;
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
      if (!uploadSession) {
        const result = await ctx.graphqlClient
          .mutation(
            CREATE_PREVIEW_UPLOAD_SESSION_MUTATION,
            { deviceRunSessionId },
            {
              // Keep the client's auth headers and combine cancellation after URQL sets its signal.
              fetch: (url, options) =>
                globalThis.fetch(url, {
                  ...options,
                  signal: AbortSignal.any([signal, ...(options?.signal ? [options.signal] : [])]),
                }),
            }
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
        };
      }
      if (controller.signal.aborted) {
        return;
      }
      const response = await putPreviewAsync(uploadSession, { image, signal });
      if (!response.ok) {
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

/**
 * Homebrew's FFmpeg is built without libwebp, so macOS encodes previews with `cwebp` from
 * Homebrew's webp package instead. Throws when it cannot be installed.
 */
export async function ensureMacosPreviewEncoderInstalledAsync({
  env,
  logger,
}: {
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<void> {
  if ((await asyncResult(spawn('cwebp', ['-version'], { env, stdio: 'pipe' }))).ok) {
    return;
  }
  logger.info('Installing webp with Homebrew for the session preview.');
  await spawn('brew', ['install', 'webp'], {
    env: { ...env, HOMEBREW_NO_AUTO_UPDATE: '1' },
    logger,
  });
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
    const options = { env, signal, timeout: 30_000, stdio: 'pipe' as const };
    const preview = path.join(directory, 'preview.webp');
    if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
      await captureIosPreviewAsync({ device, directory, preview, options });
    } else {
      await captureAndroidPreviewAsync({ device, directory, preview, options });
    }
    return await readFile(preview);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type CaptureOptions = {
  env: BuildStepEnv;
  signal: AbortSignal;
  timeout: number;
  stdio: 'pipe';
};

async function captureIosPreviewAsync({
  device,
  directory,
  preview,
  options,
}: {
  device: string;
  directory: string;
  preview: string;
  options: CaptureOptions;
}): Promise<void> {
  const screenshot = path.join(directory, 'screen.png');
  const resized = path.join(directory, 'resized.png');
  await spawn('xcrun', ['simctl', 'io', device, 'screenshot', screenshot], options);
  await spawn('sips', ['-Z', String(PREVIEW_MAX_DIMENSION), screenshot, '--out', resized], options);
  await spawn('cwebp', ['-quiet', '-q', String(PREVIEW_QUALITY), resized, '-o', preview], options);
}

async function captureAndroidPreviewAsync({
  device,
  directory,
  preview,
  options,
}: {
  device: string;
  directory: string;
  preview: string;
  options: CaptureOptions;
}): Promise<void> {
  const screenshot = path.join(directory, 'screen.png');
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
    pipeline(capture.child.stdout!, createWriteStream(screenshot), { signal: options.signal }),
  ]);
  await spawn(
    'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-i',
      screenshot,
      '-vf',
      `scale=${PREVIEW_MAX_DIMENSION}:${PREVIEW_MAX_DIMENSION}:force_original_aspect_ratio=decrease`,
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-quality',
      String(PREVIEW_QUALITY),
      preview,
    ],
    options
  );
}
