import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CustomBuildContext } from '../../../customBuildContext';
import {
  findUnlistedDeviceScreenRecordingsAsync,
  uploadDeviceRunSessionScreenRecordingsAsync,
} from '../deviceRunSessionScreenRecordings';

// Runs with `yarn jest-ffmpeg`, which needs ffmpeg and ffprobe on PATH.

jest.unmock('node-fetch');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');

let handle: (request: IncomingMessage, response: ServerResponse) => void;
let server: ReturnType<typeof createServer>;
let ctx: CustomBuildContext;
let url: string;
let directory: string;
let creationBodies: string[];
let creationTokens: (string | undefined)[];

beforeEach(async () => {
  creationBodies = [];
  creationTokens = [];
  directory = await mkdtemp(path.join(tmpdir(), 'recording-recovery-'));
  server = createServer((request, response) => {
    if (request.url === '/v2/device-run-session-worker/artifact-upload-sessions') {
      request.setEncoding('utf8');
      let body = '';
      request.on('data', chunk => (body += chunk));
      request.on('end', () => {
        creationBodies.push(body);
        creationTokens.push(request.headers['expo-device-run-session-token'] as string | undefined);
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            data: {
              uploadSession: {
                url: `${url}/artifact/${encodeURIComponent(JSON.parse(body).filename)}`,
                headers: {},
              },
            },
          })
        );
      });
    } else {
      handle(request, response);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing test server address');
  }
  url = `http://127.0.0.1:${address.port}`;
  ctx = {
    env: { EAS_DEVICE_RUN_SESSION_TOKEN: 'session-token' },
    expoApiV2BaseUrl: `${url}/v2/`,
  } as unknown as CustomBuildContext;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

it('recovers unlisted recordings from a killed host and flags the unfinished ones as partial', async () => {
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
  const env = process.env as BuildStepEnv;
  const cut = path.join(directory, 'cut');
  const empty = path.join(directory, 'empty');
  const failed = path.join(directory, 'failed');
  const done = path.join(directory, 'done');
  await mkdir(cut);
  await mkdir(empty);
  await mkdir(failed);
  await mkdir(done);
  const manifest = {
    udid: 'emulator-5554',
    deviceName: 'Pixel',
    runtimeDisplayName: 'Android 16',
    status: 'recording',
    recording: 'recording.mp4.partial',
    firstFrameWallClock: { iso8601: '2026-07-10T10:00:00.000Z' },
    width: 128,
    height: 96,
  };
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=128x96:r=1',
    '-t',
    '3',
    '-c:v',
    'libx264',
    '-g',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    'frag_keyframe+empty_moov',
    '-f',
    'mp4',
    path.join(cut, 'recording.mp4.partial'),
  ]);
  await writeFile(path.join(cut, 'session.json'), JSON.stringify(manifest));
  await writeFile(path.join(empty, 'recording.mp4.partial'), new Uint8Array(28));
  await writeFile(path.join(empty, 'session.json'), JSON.stringify(manifest));
  await copyFile(
    path.join(cut, 'recording.mp4.partial'),
    path.join(failed, 'recording.mp4.partial')
  );
  await writeFile(
    path.join(failed, 'session.json'),
    JSON.stringify({
      ...manifest,
      status: 'failed',
      error: 'Recording finalization exceeded 30000 ms.',
    })
  );

  await copyFile(path.join(cut, 'recording.mp4.partial'), path.join(done, 'recording.mp4'));
  await writeFile(
    path.join(done, 'session.json'),
    JSON.stringify({ ...manifest, status: 'complete', recording: 'recording.mp4' })
  );

  const recordings = await findUnlistedDeviceScreenRecordingsAsync({
    root: directory,
    env,
    logger,
  });
  expect(recordings).toEqual([
    {
      udid: 'emulator-5554',
      deviceName: 'Pixel',
      runtimeDisplayName: 'Android 16',
      directory: cut,
    },
    {
      udid: 'emulator-5554',
      deviceName: 'Pixel',
      runtimeDisplayName: 'Android 16',
      directory: done,
    },
    {
      udid: 'emulator-5554',
      deviceName: 'Pixel',
      runtimeDisplayName: 'Android 16',
      directory: failed,
    },
  ]);
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('empty/recording.mp4.partial'));

  const uploaded = new Map<string, Buffer>();
  handle = (request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      uploaded.set(request.url!, Buffer.concat(chunks));
      response.statusCode = 200;
      response.end();
    });
  };
  await expect(
    uploadDeviceRunSessionScreenRecordingsAsync(ctx, {
      logger,
      deviceRunSessionId: 'drs-id',
      recordings,
    })
  ).resolves.toBe(true);
  for (const recording of recordings) {
    const manifest = await readFile(path.join(recording.directory, 'session.json'));
    const recordingId = path.basename(recording.directory);
    expect(uploaded.get(`/artifact/${recordingId}.json`)).toEqual(manifest);
    expect(uploaded.get(`/artifact/${recordingId}.mp4`)).toEqual(
      await readFile(path.join(recording.directory, JSON.parse(manifest.toString()).recording))
    );
  }
  expect(creationTokens).toEqual(Array(6).fill('session-token'));
  const inputs = creationBodies
    .map(body => JSON.parse(body))
    .filter(input => input.kind === 'screen-recording')
    .sort((a, b) => a.filename.localeCompare(b.filename));
  expect(inputs.map(input => input.filename)).toEqual(['cut.mp4', 'done.mp4', 'failed.mp4']);
  expect(inputs.map(input => input.name.includes(', partial)'))).toEqual([true, false, true]);
  expect(inputs[1].metadata).not.toHaveProperty('partial');
  expect(inputs[0].metadata).toMatchObject({
    partial: true,
    partialReason: 'The Device Hub stopped before it could finalize the recording.',
    width: 128,
    height: 96,
  });
  const manifests = creationBodies
    .map(body => JSON.parse(body))
    .filter(input => input.kind === 'screen-recording-telemetry')
    .sort((a, b) => a.filename.localeCompare(b.filename));
  expect(manifests.map(input => input.filename)).toEqual(['cut.json', 'done.json', 'failed.json']);
  expect(manifests.map(input => input.metadata.recordingFilename)).toEqual([
    'cut.mp4',
    'done.mp4',
    'failed.mp4',
  ]);
  expect(inputs[2].metadata).toMatchObject({
    partial: true,
    partialReason: 'Recording finalization exceeded 30000 ms.',
  });
});
