import type { bunyan } from '@expo/logger';
import { BuildRuntimePlatform } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import { createScreenshotMetadataAsync } from '../deviceRunSessionScreenshotMetadata';
import { uploadDeviceRunSessionScreenshotAsync } from '../deviceRunSessionScreenshotThumbnails';

jest.mock('@expo/turtle-spawn');
jest.mock('../deviceRunSessionArtifacts');
jest.mock('../deviceRunSessionScreenshotMetadata');

const ctx = {} as CustomBuildContext;
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
const env = { PATH: '/opt/homebrew/bin:/usr/bin' };
let directory: string;
let file: string;
let uploaded: { filename: string; content: string }[];

function screenshotOptions(width = 1179) {
  return {
    file,
    deviceRunSessionId: 'session-id',
    artifactId: 'artifact-id',
    name: 'Screenshot 1',
    filename: 'screenshot-1.png',
    kind: 'screenshot',
    size: 11,
    metadata: { __eas_type: 'screenshot', source: 'manual' as const, width, height: 2556 },
    attempts: 3,
    logger,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), 'screenshot-thumbnails-test-'));
  file = path.join(directory, 'screenshot.png');
  await writeFile(file, 'png-content');
  uploaded = [];
  jest.mocked(spawn).mockImplementation((async (_command: string, args: string[]) => {
    const output = args.includes('-o') ? args[args.indexOf('-o') + 1] : args.at(-1)!;
    await writeFile(output, 'webp');
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
  await rm(directory, { recursive: true, force: true });
});

it('uploads only the screenshot when no encoder is given', async () => {
  await uploadDeviceRunSessionScreenshotAsync(ctx, screenshotOptions());

  expect(spawn).not.toHaveBeenCalled();
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledWith(ctx, {
    deviceRunSessionId: 'session-id',
    artifactId: 'artifact-id',
    name: 'Screenshot 1',
    filename: 'screenshot-1.png',
    kind: 'screenshot',
    size: 11,
    metadata: { __eas_type: 'screenshot', source: 'manual', width: 1179, height: 2556 },
    attempts: 3,
    openStream: expect.any(Function),
  });
});

it('uploads only the screenshot when it is already 480 px wide or less', async () => {
  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...screenshotOptions(480),
    thumbnailEncoder: { runtimePlatform: BuildRuntimePlatform.DARWIN, env },
  });

  expect(spawn).not.toHaveBeenCalled();
  expect(uploaded).toEqual([{ filename: 'screenshot-1.png', content: 'png-content' }]);
});

it('uploads a WebP copy made with cwebp on macOS and links it with a shared key', async () => {
  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...screenshotOptions(),
    thumbnailEncoder: { runtimePlatform: BuildRuntimePlatform.DARWIN, env },
  });

  expect(spawn).toHaveBeenCalledWith(
    'cwebp',
    ['-quiet', '-q', '70', '-resize', '480', '0', file, '-o', expect.stringMatching(/\.webp$/)],
    expect.objectContaining({ env, stdio: 'pipe', timeout: 30_000 })
  );
  expect(uploaded).toEqual([
    { filename: 'screenshot-1.png', content: 'png-content' },
    { filename: 'screenshot-1.thumbnail.webp', content: 'webp' },
  ]);
  const [[, screenshot], [, thumbnail]] = jest.mocked(uploadDeviceRunSessionArtifactAsync).mock
    .calls;
  const thumbnailKey = screenshot.metadata?.thumbnailKey;
  expect(thumbnailKey).toEqual(expect.any(String));
  expect(screenshot).toEqual(
    expect.objectContaining({
      kind: 'screenshot',
      metadata: {
        __eas_type: 'screenshot',
        source: 'manual',
        width: 1179,
        height: 2556,
        thumbnailKey,
      },
    })
  );
  expect(thumbnail).toEqual({
    deviceRunSessionId: 'session-id',
    artifactId: 'artifact-id-thumbnail',
    name: 'Screenshot 1 thumbnail',
    filename: 'screenshot-1.thumbnail.webp',
    kind: 'screenshot-thumbnail',
    size: 4,
    metadata: {
      __eas_type: 'screenshot-thumbnail',
      source: 'manual',
      width: 480,
      height: 1041,
      thumbnailKey,
    },
    attempts: 3,
    openStream: expect.any(Function),
  });
});

it('encodes the WebP copy with FFmpeg on Linux', async () => {
  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...screenshotOptions(),
    thumbnailEncoder: { runtimePlatform: BuildRuntimePlatform.LINUX, env },
  });

  expect(spawn).toHaveBeenCalledWith(
    'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-i',
      file,
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

it('uploads the screenshot without a key when the copy cannot be encoded', async () => {
  jest.mocked(spawn).mockRejectedValue(new Error('cwebp: command not found'));

  await uploadDeviceRunSessionScreenshotAsync(ctx, {
    ...screenshotOptions(),
    thumbnailEncoder: { runtimePlatform: BuildRuntimePlatform.DARWIN, env },
  });

  expect(uploaded).toEqual([{ filename: 'screenshot-1.png', content: 'png-content' }]);
  expect(
    jest.mocked(uploadDeviceRunSessionArtifactAsync).mock.calls[0][1].metadata
  ).not.toHaveProperty('thumbnailKey');
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ file }),
    'Could not create a small copy of the screenshot. The website uses the full screenshot.'
  );
});

it('does not fail the screenshot upload when the copy cannot be uploaded', async () => {
  jest
    .mocked(uploadDeviceRunSessionArtifactAsync)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('upload failed'));

  await expect(
    uploadDeviceRunSessionScreenshotAsync(ctx, {
      ...screenshotOptions(),
      thumbnailEncoder: { runtimePlatform: BuildRuntimePlatform.DARWIN, env },
    })
  ).resolves.toBeUndefined();

  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(2);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ file }),
    'Could not upload the small copy of the screenshot. The website uses the full screenshot.'
  );
});

it('does not upload the copy when the screenshot upload fails', async () => {
  jest.mocked(uploadDeviceRunSessionArtifactAsync).mockRejectedValue(new Error('upload failed'));

  await expect(
    uploadDeviceRunSessionScreenshotAsync(ctx, {
      ...screenshotOptions(),
      thumbnailEncoder: { runtimePlatform: BuildRuntimePlatform.DARWIN, env },
    })
  ).rejects.toThrow('upload failed');

  expect(uploadDeviceRunSessionArtifactAsync).toHaveBeenCalledTimes(1);
});
