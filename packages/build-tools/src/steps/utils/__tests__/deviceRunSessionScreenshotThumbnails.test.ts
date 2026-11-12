import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { ensureMacosPreviewEncoderInstalledAsync } from '../deviceRunSessionPreview';
import { createScreenshotMetadataAsync } from '../deviceRunSessionScreenshotMetadata';
import {
  type ScreenshotThumbnails,
  createScreenshotThumbnails,
  uploadDeviceRunSessionScreenshotAsync,
} from '../deviceRunSessionScreenshotThumbnails';

jest.mock('@expo/turtle-spawn');
jest.mock('../deviceRunSessionArtifacts');
jest.mock('../deviceRunSessionPreview');
jest.mock('../deviceRunSessionScreenshotMetadata');

const ctx = {} as CustomBuildContext;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const env = { PATH: '/opt/homebrew/bin:/usr/bin' };
const COPY_WARNING =
  'Could not create or upload a small copy of a screenshot. The website shows the full screenshot.';
let directory: string;
let uploaded: { filename: string; content: string }[];
let encodedSources: string[];
let queues: ScreenshotThumbnails[];

function createQueue(runtimePlatform = BuildRuntimePlatform.DARWIN): ScreenshotThumbnails {
  const queue = createScreenshotThumbnails(ctx, { runtimePlatform, env, logger });
  queues.push(queue);
  return queue;
}

async function screenshotOptions(index = 1, width = 1179) {
  const file = path.join(directory, `screenshot-${index}.png`);
  await writeFile(file, `png-content-${index}`);
  return {
    file,
    deviceRunSessionId: 'session-id',
    artifactId: `artifact-${index}`,
    name: `Screenshot ${index}`,
    filename: `screenshot-${index}.png`,
    kind: 'screenshot',
    size: 13,
    metadata: { __eas_type: 'screenshot', source: 'manual' as const, width, height: 2556 },
    attempts: 3,
  };
}

function uploadCalls() {
  return jest.mocked(uploadDeviceRunSessionArtifactAsync).mock.calls.map(([, options]) => options);
}

beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), 'screenshot-thumbnails-test-'));
  uploaded = [];
  encodedSources = [];
  queues = [];
  jest.mocked(ensureMacosPreviewEncoderInstalledAsync).mockResolvedValue(undefined);
  jest.mocked(spawn).mockImplementation((async (_command: string, args: string[]) => {
    const input = args.includes('-o') ? args[args.indexOf('-o') - 1] : args[args.indexOf('-i') + 1];
    const output = args.includes('-o') ? args[args.indexOf('-o') + 1] : args.at(-1)!;
    encodedSources.push(input);
    await writeFile(output, `webp-of-${await readFile(input, 'utf8')}`);
    return { stdout: '', stderr: '' };
  }) as unknown as typeof spawn);
  jest
    .mocked(createScreenshotMetadataAsync)
    .mockResolvedValue({ source: 'manual', width: 480, height: 1041 });
  jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mockImplementation(async (_ctx, { filename, openStream }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of openStream()) {
        chunks.push(Buffer.from(chunk));
      }
      uploaded.push({ filename, content: Buffer.concat(chunks).toString() });
    });
});

afterEach(async () => {
  await Promise.all(queues.map(queue => queue.closeAsync(0)));
  await rm(directory, { recursive: true, force: true });
});

it('uploads only the screenshot when no queue is given', async () => {
  await uploadDeviceRunSessionScreenshotAsync(ctx, await screenshotOptions());

  expect(uploadCalls()).toEqual([
    {
      deviceRunSessionId: 'session-id',
      artifactId: 'artifact-1',
      name: 'Screenshot 1',
      filename: 'screenshot-1.png',
      kind: 'screenshot',
      size: 13,
      metadata: { __eas_type: 'screenshot', source: 'manual', width: 1179, height: 2556 },
      attempts: 3,
      openStream: expect.any(Function),
    },
  ]);
});

it('makes no copy of a screenshot that is already 480 px wide or less', async () => {
  const thumbnails = createQueue();
  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...(await screenshotOptions(1, 480)),
    thumbnails,
  });
  await thumbnails.closeAsync();

  expect(spawn).not.toHaveBeenCalled();
  expect(uploaded).toEqual([{ filename: 'screenshot-1.png', content: 'png-content-1' }]);
});

it('uploads a WebP copy made with cwebp on macOS and links it with a shared key', async () => {
  const thumbnails = createQueue();
  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions()), thumbnails });
  await thumbnails.closeAsync();

  expect(ensureMacosPreviewEncoderInstalledAsync).toHaveBeenCalledWith({
    env,
    logger,
    signal: expect.any(AbortSignal),
  });
  expect(spawn).toHaveBeenCalledWith(
    'cwebp',
    [
      '-quiet',
      '-q',
      '70',
      '-resize',
      '480',
      '0',
      expect.any(String),
      '-o',
      expect.stringMatching(/\.webp$/),
    ],
    expect.objectContaining({
      env,
      stdio: 'pipe',
      timeout: 10_000,
      signal: expect.any(AbortSignal),
    })
  );
  expect(uploaded).toEqual([
    { filename: 'screenshot-1.png', content: 'png-content-1' },
    { filename: 'screenshot-1.thumbnail.webp', content: 'webp-of-png-content-1' },
  ]);
  const [screenshot, thumbnail] = uploadCalls();
  const thumbnailKey = screenshot.metadata?.thumbnailKey;
  expect(thumbnailKey).toEqual(expect.any(String));
  expect(screenshot.metadata).toEqual({
    __eas_type: 'screenshot',
    source: 'manual',
    width: 1179,
    height: 2556,
    thumbnailKey,
  });
  expect(thumbnail).toEqual({
    deviceRunSessionId: 'session-id',
    artifactId: 'artifact-1-thumbnail',
    name: 'Screenshot 1 thumbnail',
    filename: 'screenshot-1.thumbnail.webp',
    kind: 'screenshot-thumbnail',
    size: 'webp-of-png-content-1'.length,
    metadata: {
      __eas_type: 'screenshot-thumbnail',
      source: 'manual',
      width: 480,
      height: 1041,
      thumbnailKey,
    },
    attempts: 1,
    signal: expect.any(AbortSignal),
    openStream: expect.any(Function),
  });
});

it('encodes the WebP copy with FFmpeg on Linux', async () => {
  const thumbnails = createQueue(BuildRuntimePlatform.LINUX);
  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions()), thumbnails });
  await thumbnails.closeAsync();

  expect(ensureMacosPreviewEncoderInstalledAsync).not.toHaveBeenCalled();
  expect(spawn).toHaveBeenCalledWith(
    'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-i',
      expect.any(String),
      '-vf',
      'scale=480:-1',
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-quality',
      '70',
      expect.stringMatching(/\.webp$/),
    ],
    expect.objectContaining({ env })
  );
  expect(uploaded.map(({ filename }) => filename)).toEqual([
    'screenshot-1.png',
    'screenshot-1.thumbnail.webp',
  ]);
});

it('keeps its own copy of the screenshot, so the caller can remove the file at once', async () => {
  const thumbnails = createQueue();
  const options = await screenshotOptions();
  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...options, thumbnails });
  await rm(options.file);
  await thumbnails.closeAsync();

  expect(uploaded.at(-1)).toEqual({
    filename: 'screenshot-1.thumbnail.webp',
    content: 'webp-of-png-content-1',
  });
  expect(encodedSources).toHaveLength(1);
  expect(encodedSources[0]).not.toBe(options.file);
  expect(existsSync(encodedSources[0])).toBe(false);
});

it('does not delay the next screenshot while a copy stalls', async () => {
  const thumbnails = createQueue();
  let copyUploadStarted!: () => void;
  const copyUploadStartedPromise = new Promise<void>(resolve => {
    copyUploadStarted = resolve;
  });
  jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mockImplementation(async (_ctx, { filename, signal }) => {
      if (!filename.endsWith('.thumbnail.webp')) {
        uploaded.push({ filename, content: '' });
        return;
      }
      copyUploadStarted();
      // The copy upload stalls until the queue is closed.
      await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...(await screenshotOptions(1)),
    thumbnails,
  });
  await copyUploadStartedPromise;
  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...(await screenshotOptions(2)),
    thumbnails,
  });

  expect(uploaded.map(({ filename }) => filename)).toEqual([
    'screenshot-1.png',
    'screenshot-2.png',
  ]);
  await thumbnails.closeAsync(10);
  expect(logger.info).toHaveBeenCalledWith(
    'Cancelled 2 small screenshot copies at the end of the session. The website shows the full screenshots.'
  );
  expect(logger.warn).not.toHaveBeenCalled();
  expect(encodedSources).toHaveLength(1);
});

it('skips one copy that cannot be encoded and makes the next one', async () => {
  const thumbnails = createQueue();
  const encode = jest.mocked(spawn).getMockImplementation()!;
  jest.mocked(spawn).mockRejectedValueOnce(new Error('cwebp: cannot read input'));
  jest.mocked(spawn).mockImplementation(encode);

  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions(1)), thumbnails });
  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions(2)), thumbnails });
  await thumbnails.closeAsync();

  expect(uploaded.map(({ filename }) => filename)).toEqual([
    'screenshot-1.png',
    'screenshot-2.png',
    'screenshot-2.thumbnail.webp',
  ]);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ artifactId: 'artifact-1' }),
    COPY_WARNING
  );
});

it('stops making copies with one warning when the encoder command is missing', async () => {
  const thumbnails = createQueue(BuildRuntimePlatform.LINUX);
  jest
    .mocked(spawn)
    .mockRejectedValue(
      Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT', syscall: 'spawn ffmpeg' })
    );

  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions(1)), thumbnails });
  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions(2)), thumbnails });
  await thumbnails.closeAsync();
  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions(3)), thumbnails });

  expect(uploaded.map(({ filename }) => filename)).toEqual([
    'screenshot-1.png',
    'screenshot-2.png',
    'screenshot-3.png',
  ]);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.any(Error) }),
    'FFmpeg is not available. The website shows full screenshots for this session.'
  );
});

it('installs cwebp once and stops making copies with one warning when it cannot', async () => {
  const thumbnails = createQueue();
  jest
    .mocked(ensureMacosPreviewEncoderInstalledAsync)
    .mockRejectedValue(new Error('brew install webp failed'));

  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions(1)), thumbnails });
  await uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions(2)), thumbnails });
  await thumbnails.closeAsync();

  expect(ensureMacosPreviewEncoderInstalledAsync).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
  expect(uploaded.map(({ filename }) => filename)).toEqual([
    'screenshot-1.png',
    'screenshot-2.png',
  ]);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ err: expect.any(Error) }),
    'Could not install cwebp. The website shows full screenshots for this session.'
  );
});

it('keeps the display rotation in the metadata of the copy', async () => {
  const thumbnails = createQueue();
  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...(await screenshotOptions()),
    metadata: {
      source: 'agent-device',
      width: 2556,
      height: 1179,
      displayRotation: 'landscape-left',
    },
    thumbnails,
  });
  await thumbnails.closeAsync();

  expect(createScreenshotMetadataAsync).toHaveBeenCalledWith(expect.stringMatching(/\.webp$/), {
    source: 'agent-device',
    displayRotation: 'landscape-left',
    logger,
  });
});

it('does not fail the screenshot upload when the copy cannot be uploaded', async () => {
  const thumbnails = createQueue();
  jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('upload failed'));

  await expect(
    uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions()), thumbnails })
  ).resolves.toBeUndefined();
  await thumbnails.closeAsync();

  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ artifactId: 'artifact-1' }),
    COPY_WARNING
  );
});

it('makes no copy when the screenshot upload fails', async () => {
  const thumbnails = createQueue();
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValue(new Error('upload failed'));

  await expect(
    uploadDeviceRunSessionScreenshotAsync(ctx, { ...(await screenshotOptions()), thumbnails })
  ).rejects.toThrow('upload failed');
  await thumbnails.closeAsync();

  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
});

it('makes no copy after the screenshot upload is aborted', async () => {
  const thumbnails = createQueue();
  const controller = new AbortController();
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockImplementation(async () => {
    controller.abort();
  });

  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...(await screenshotOptions()),
    signal: controller.signal,
    thumbnails,
  });
  await thumbnails.closeAsync();

  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
});
