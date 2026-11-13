import { type bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import { BuildRuntimePlatform, type BuildStepEnv } from '@expo/steps';
import spawn, { type SpawnOptions } from '@expo/turtle-spawn';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../customBuildContext';
import { uploadContentWithSignedUrl } from '../../storage/uploadWithSignedUrl';
import { killProcessGroup } from '../../utils/processes';
import {
  type CapturedDisplayRotation,
  type DisplayRotation,
  type ImageSize,
  type ScreenshotMetadata,
  readImageSize,
} from './deviceRunSessionScreenshotMetadata';
import { requireDeviceRunSessionWorkerApi } from './deviceRunSessionWorkerApi';

const PREVIEW_INTERVAL_MS = 60_000;
const PREVIEW_MAX_DIMENSION = 320;
const PREVIEW_QUALITY = 70;
const MAX_PREVIEW_SIZE_BYTES = 5 * 1024 * 1024;

export type DeviceRunSessionPreviewCapture = { image: Buffer } & CapturedDisplayRotation;

type PreviewMetadata = { size?: ImageSize } & CapturedDisplayRotation;

function isSamePreviewMetadata(a: PreviewMetadata, b: PreviewMetadata | undefined): boolean {
  return (
    a.size?.width === b?.size?.width &&
    a.size?.height === b?.size?.height &&
    a.displayRotation === b?.displayRotation
  );
}

export function startDeviceRunSessionPreview({
  ctx,
  captureAsync,
  logger,
}: {
  ctx: CustomBuildContext;
  deviceRunSessionId: string;
  captureAsync: (signal: AbortSignal) => Promise<DeviceRunSessionPreviewCapture>;
  logger: bunyan;
}): { stopAsync: () => Promise<void> } {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let uploadSession: { url: string; headers: Record<string, string> } | undefined;
  let storedMetadata: PreviewMetadata | undefined;
  let pending: Promise<void>;

  const uploadAsync = async (): Promise<void> => {
    const deadline = AbortSignal.timeout(60_000);
    const signal = AbortSignal.any([controller.signal, deadline]);
    try {
      const { image, displayRotation } = await captureAsync(signal);
      if (controller.signal.aborted) {
        return;
      }
      if (image.length === 0 || image.length > MAX_PREVIEW_SIZE_BYTES) {
        throw new Error('Session preview is empty or exceeds the 5 MiB upload limit.');
      }
      const metadata: PreviewMetadata = { size: readImageSize(image), displayRotation };
      if (!uploadSession) {
        uploadSession = await createPreviewUploadSessionAsync(ctx, metadata, signal);
        storedMetadata = metadata;
      }
      if (controller.signal.aborted) {
        return;
      }
      await uploadContentWithSignedUrl(
        { signedUrl: uploadSession, content: image },
        { signal, retries: 0, stallTimeoutMs: 30_000 }
      );
      // The upload session stores the metadata, so a new one updates it for this image. A stop
      // does not cancel this, so the last preview keeps metadata that matches it.
      if (!metadata.size || isSamePreviewMetadata(metadata, storedMetadata)) {
        return;
      }
      storedMetadata = undefined;
      uploadSession = await createPreviewUploadSessionAsync(ctx, metadata, deadline);
      storedMetadata = metadata;
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

async function createPreviewUploadSessionAsync(
  ctx: CustomBuildContext,
  { size, displayRotation }: PreviewMetadata,
  signal: AbortSignal
): Promise<{ url: string; headers: Record<string, string> }> {
  const metadata: ScreenshotMetadata | undefined =
    size || displayRotation ? { source: 'preview', ...size, displayRotation } : undefined;
  return await requireDeviceRunSessionWorkerApi(ctx).createPreviewUploadSessionAsync(
    { metadata },
    { signal }
  );
}

/**
 * Homebrew's FFmpeg is built without libwebp, so macOS encodes previews with `cwebp` from
 * Homebrew's webp package instead. Throws when it cannot be installed.
 */
export async function ensureMacosPreviewEncoderInstalledAsync({
  env,
  logger,
  signal,
}: {
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
}): Promise<void> {
  const probe = await asyncResult(
    runEncoderCommandAsync('cwebp', ['-version'], { env, stdio: 'pipe' }, signal)
  );
  if (probe.ok) {
    return;
  }
  signal?.throwIfAborted();
  logger.info('Installing webp with Homebrew for the session preview.');
  await runEncoderCommandAsync(
    'brew',
    ['install', 'webp'],
    { env: { ...env, HOMEBREW_NO_AUTO_UPDATE: '1' }, logger },
    signal
  );
}

async function runEncoderCommandAsync(
  command: string,
  args: string[],
  options: SpawnOptions,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const task = spawn(command, args, { ...options, detached: true });
  const abort = (): void => killProcessGroup(task.child, 'SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  try {
    await task;
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

export async function captureDeviceRunSessionPreviewAsync({
  runtimePlatform,
  device,
  env,
  signal,
  captureIosScreenshotAsync,
}: {
  runtimePlatform: BuildRuntimePlatform;
  device: string;
  env: BuildStepEnv;
  signal: AbortSignal;
  captureIosScreenshotAsync?: IosScreenshotCapture;
}): Promise<DeviceRunSessionPreviewCapture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'session-preview-'));
  try {
    const options = { env, signal, timeout: 30_000, stdio: 'pipe' as const };
    const preview = path.join(directory, 'preview.webp');
    let displayRotation: DisplayRotation | undefined;
    if (runtimePlatform === BuildRuntimePlatform.DARWIN) {
      if (!captureIosScreenshotAsync) {
        throw new Error(
          'Cannot capture the iOS session preview: serve-sim screenshot capture is not configured.'
        );
      }
      ({ displayRotation } = await captureIosPreviewAsync({
        captureIosScreenshotAsync,
        directory,
        preview,
        options,
      }));
    } else {
      // adb screencap reports no rotation.
      await captureAndroidPreviewAsync({ device, directory, preview, options });
    }
    const image = await readFile(preview);
    return { image, displayRotation };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type IosScreenshotCapture = (file: string, signal: AbortSignal) => Promise<CapturedDisplayRotation>;

type CaptureOptions = {
  env: BuildStepEnv;
  signal: AbortSignal;
  timeout: number;
  stdio: 'pipe';
};

async function captureIosPreviewAsync({
  captureIosScreenshotAsync,
  directory,
  preview,
  options,
}: {
  captureIosScreenshotAsync: IosScreenshotCapture;
  directory: string;
  preview: string;
  options: CaptureOptions;
}): Promise<CapturedDisplayRotation> {
  const screenshot = path.join(directory, 'screen.png');
  const resized = path.join(directory, 'resized.png');
  const captured = await captureIosScreenshotAsync(screenshot, options.signal);
  options.signal.throwIfAborted();
  await spawn('sips', ['-Z', String(PREVIEW_MAX_DIMENSION), screenshot, '--out', resized], options);
  await spawn('cwebp', ['-quiet', '-q', String(PREVIEW_QUALITY), resized, '-o', preview], options);
  return captured;
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
