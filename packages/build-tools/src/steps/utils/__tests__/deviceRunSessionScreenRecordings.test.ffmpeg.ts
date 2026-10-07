import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import { Client, fetchExchange } from '@urql/core';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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

beforeEach(async () => {
  creationBodies = [];
  directory = await mkdtemp(path.join(tmpdir(), 'recording-recovery-'));
  server = createServer((request, response) => {
    if (request.url === '/graphql') {
      request.setEncoding('utf8');
      let body = '';
      request.on('data', chunk => (body += chunk));
      request.on('end', () => {
        creationBodies.push(body);
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            data: {
              deviceRunSession: {
                createArtifactUploadSession: {
                  uploadSession: { url: `${url}/artifact`, headers: {} },
                },
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
    graphqlClient: new Client({
      url: `${url}/graphql`,
      exchanges: [fetchExchange],
      fetchOptions: { headers: { Authorization: 'Bearer test-auth' } },
    }),
  } as CustomBuildContext;
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

  let putBytes = 0;
  handle = (request, response) => {
    request.on('data', chunk => (putBytes += chunk.length));
    request.on('end', () => {
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
  expect(putBytes).toBe(3 * (await stat(path.join(cut, 'recording.mp4.partial'))).size);
  const inputs = creationBodies
    .map(body => JSON.parse(body).variables.input)
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
  expect(inputs[2].metadata).toMatchObject({
    partial: true,
    partialReason: 'Recording finalization exceeded 30000 ms.',
  });
});
