import { Client, fetchExchange } from '@urql/core';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { CustomBuildContext } from '../../../customBuildContext';
import { uploadDeviceRunSessionArtifactAsync } from '../deviceRunSessionArtifacts';

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

beforeEach(async () => {
  creates = 0;
  authorization = undefined;
  stallCreation = false;
  creationStarted = deferred();
  directory = await mkdtemp(path.join(tmpdir(), 'recording-upload-http-'));
  server = createServer((request, response) => {
    if (request.url === '/graphql') {
      creates++;
      authorization = request.headers.authorization;
      creationStarted.resolve(request);
      request.resume();
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
