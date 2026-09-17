import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import { Client, fetchExchange } from '@urql/core';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import type { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';
import {
  findUnlistedDeviceScreenRecordingsAsync,
  uploadDeviceRunSessionScreenRecordingsAsync,
} from '../deviceRunSessionScreenRecordings';

jest.unmock('node-fetch');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const metadata = {
  deviceRunSessionId: 'drs-id',
  artifactId: 'recording-id',
  name: 'Recording',
  filename: 'recording.mp4',
  kind: 'screen-recording',
  size: 16,
};
let handle: (request: IncomingMessage, response: ServerResponse) => void;
let server: ReturnType<typeof createServer>;
let ctx: CustomBuildContext;
let url: string;
let directory: string;
let creates: number;
let authorization: string | undefined;
let stallCreation: boolean;
let creationStarted: ReturnType<typeof deferred<IncomingMessage>>;
let creationBodies: string[];

beforeEach(async () => {
  creates = 0;
  authorization = undefined;
  stallCreation = false;
  creationBodies = [];
  creationStarted = deferred();
  directory = await mkdtemp(path.join(tmpdir(), 'recording-upload-http-'));
  server = createServer((request, response) => {
    if (request.url === '/graphql') {
      creates++;
      authorization = request.headers.authorization;
      creationStarted.resolve(request);
      request.setEncoding('utf8');
      let body = '';
      request.on('data', chunk => (body += chunk));
      request.on('end', () => creationBodies.push(body));
      request.on('end', () => {
        if (stallCreation) {
          return;
        }
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

it('replays the full file after a transient PUT failure without recreating the upload session', async () => {
  const bodies: string[] = [];
  handle = (request, response) => {
    const chunks: string[] = [];
    request.setEncoding('utf8');
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      bodies.push(chunks.join(''));
      response.statusCode = bodies.length === 1 ? 503 : 200;
      response.end();
    });
  };
  const file = path.join(directory, 'recording.mp4');
  const payload = '*'.repeat(128 * 1024);
  await writeFile(file, payload);
  const streams: Readable[] = [];
  const open = () => {
    const stream = createReadStream(file);
    streams.push(stream);
    return stream;
  };
  await uploadDeviceRunSessionArtifactAsync(ctx, {
    ...metadata,
    size: payload.length,
    stream: open(),
    reopenStream: open,
  });
  expect(creates).toBe(1);
  expect(authorization).toBe('Bearer test-auth');
  expect(bodies).toEqual([payload, payload]);
  expect(streams).toHaveLength(2);
  expect(streams.every(stream => stream.destroyed)).toBe(true);
});

it('keeps a slow PUT alive while its body is still flowing', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  let received = 0;
  let onChunk = () => {};
  handle = (request, response) => {
    request.on('data', chunk => {
      received += chunk.length;
      onChunk();
    });
    request.on('end', () => {
      response.statusCode = 200;
      response.end();
    });
  };
  const waitForBytes = (total: number) =>
    new Promise<void>(resolve => {
      onChunk = () => {
        if (received >= total) {
          resolve();
        }
      };
      onChunk();
    });
  const stream = new Readable({ read() {} });
  const upload = uploadDeviceRunSessionArtifactAsync(ctx, { ...metadata, size: 3, stream });
  const settled = expect(upload).resolves.toBeUndefined();
  stream.push('a');
  await waitForBytes(1);
  await jest.advanceTimersByTimeAsync(60_000);
  stream.push('b');
  await waitForBytes(2);
  await jest.advanceTimersByTimeAsync(60_000);
  stream.push('c');
  stream.push(null);
  await settled;
  expect(received).toBe(3);
  jest.useRealTimers();
});

it('retries a PUT that stalled past the idle deadline with a fresh stream', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  let puts = 0;
  const firstBodyRead = deferred<void>();
  handle = (request, response) => {
    puts++;
    request.resume();
    request.on('end', () => {
      if (puts === 1) {
        firstBodyRead.resolve();
        return;
      }
      response.statusCode = 200;
      response.end();
    });
  };
  const streams: Readable[] = [];
  const open = () => {
    const stream = Readable.from('recording');
    streams.push(stream);
    return stream;
  };
  const upload = uploadDeviceRunSessionArtifactAsync(ctx, {
    ...metadata,
    size: 9,
    stream: open(),
    reopenStream: open,
  });
  const settled = expect(upload).resolves.toBeUndefined();
  await firstBodyRead.promise;
  await jest.advanceTimersByTimeAsync(90_000);
  await jest.advanceTimersByTimeAsync(500);
  await settled;
  expect(puts).toBe(2);
  expect(streams).toHaveLength(2);
  expect(streams.every(stream => stream.destroyed)).toBe(true);
  jest.useRealTimers();
});

it('cancels an active PUT socket and destroys its source without retrying', async () => {
  const started = deferred<void>();
  const closed = deferred<void>();
  let puts = 0;
  handle = request => {
    puts++;
    request.socket.once('close', () => closed.resolve());
    request.on('data', () => started.resolve());
  };
  const controller = new AbortController();
  const stream = new Readable({ read() {} });
  stream.push(Buffer.alloc(1024));
  const reopenStream = jest.fn(() => Readable.from('unexpected retry'));
  const upload = uploadDeviceRunSessionArtifactAsync(ctx, {
    ...metadata,
    stream,
    reopenStream,
    signal: controller.signal,
  });
  const rejected = expect(upload).rejects.toThrow('test cancellation');
  await started.promise;
  controller.abort(new Error('test cancellation'));
  await rejected;
  await closed.promise;
  expect(stream.destroyed).toBe(true);
  expect(reopenStream).not.toHaveBeenCalled();
  expect(puts).toBe(1);
});

it.each([200, 400, 503])(
  'closes a stalled HTTP %s response before leaving or retrying the PUT',
  async status => {
    const sockets = new Set<Socket>();
    let puts = 0;
    let maxOpenSockets = 0;
    handle = (request, response) => {
      puts++;
      sockets.add(request.socket);
      maxOpenSockets = Math.max(maxOpenSockets, sockets.size);
      request.socket.once('close', () => sockets.delete(request.socket));
      request.resume();
      request.on('end', () => {
        response.writeHead(status, { 'Content-Length': '1000' });
        response.flushHeaders();
        response.write('partial response');
      });
    };
    const upload = uploadDeviceRunSessionArtifactAsync(ctx, {
      ...metadata,
      stream: Readable.from('recording'),
      reopenStream: () => Readable.from('recording'),
    });
    if (status === 200) {
      await expect(upload).resolves.toBeUndefined();
    } else {
      await expect(upload).rejects.toThrow(`HTTP ${status}`);
    }
    for (let i = 0; i < 100 && sockets.size > 0; i++) {
      await delay(10);
    }
    expect(creates).toBe(1);
    expect(puts).toBe(status === 503 ? 3 : 1);
    expect(maxOpenSockets).toBe(1);
    expect(sockets.size).toBe(0);
  }
);

it('cancels urql session creation with auth intact and never starts a PUT', async () => {
  stallCreation = true;
  const puts = jest.fn();
  handle = puts;
  const controller = new AbortController();
  const stream = Readable.from('recording');
  const upload = uploadDeviceRunSessionArtifactAsync(ctx, {
    ...metadata,
    stream,
    signal: controller.signal,
  });
  const rejected = expect(upload).rejects.toThrow('test cancellation');
  const request = await creationStarted.promise;
  const closed = new Promise<void>(resolve => request.socket.once('close', resolve));
  controller.abort(new Error('test cancellation'));
  await rejected;
  await closed;
  expect(authorization).toBe('Bearer test-auth');
  expect(creates).toBe(1);
  expect(puts).not.toHaveBeenCalled();
  expect(stream.destroyed).toBe(true);
});

const hasFfmpeg = ['ffmpeg', 'ffprobe'].every(tool => spawnSync('which', [tool]).status === 0);

(hasFfmpeg ? it : it.skip)(
  'recovers unlisted recordings from a killed host and flags the unfinished ones as partial',
  async () => {
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
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('empty/recording.mp4.partial')
    );

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
  }
);
