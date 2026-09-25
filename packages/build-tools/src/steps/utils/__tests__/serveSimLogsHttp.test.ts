import { type bunyan } from '@expo/logger';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { type CustomBuildContext } from '../../../customBuildContext';
import { uploadServeSimLogsFileAsync } from '../serveSimLogsArtifacts';
import { streamServeSimLogsToFileAsync } from '../serveSimLogsRecorder';

// This test exercises actual sockets, UTF-8 decoding, files, and PUT uploads.
// Only WWW's allocation response is substituted; it does not verify cloud storage.
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.unmock('node-fetch');

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as bunyan;

let directory: string;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'simulator-logs-http-test-'));
  server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve()))
  );
  await rm(directory, { recursive: true, force: true });
});

it('streams selected-device logs into NDJSON and uploads the exact bytes as a session artifact', async () => {
  const record = JSON.stringify({ eventMessage: 'Hello 서울 🌲', process: 'MyApp' });
  const expected = Buffer.from(record + '\n');
  const envelope = JSON.stringify({ seq: 7, at: 1000, raw: record });
  const wire = Buffer.from(
    `: heartbeat\n\ndata: ${envelope}\n\ndata: invalid json\n\ndata: {"partial":`
  );
  const splitAt = wire.indexOf(Buffer.from('서울')) + 1;
  let streamRequest: { url?: string; authorization?: string } | undefined;
  let uploaded: Buffer | undefined;
  let uploadedLength: string | undefined;
  server.on('request', (request, response) => {
    if (request.method === 'GET') {
      streamRequest = { url: request.url, authorization: request.headers.authorization };
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'X-Serve-Sim-Log-Scope': 'user-apps',
      });
      response.write(wire.subarray(0, splitAt));
      setImmediate(() => response.end(wire.subarray(splitAt)));
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      uploaded = Buffer.concat(chunks);
      uploadedLength = request.headers['content-length'];
      response.writeHead(200).end();
    });
  });
  const filePath = path.join(directory, 'simulator.ndjson');
  const result = await streamServeSimLogsToFileAsync({
    serveSimUrl: baseUrl,
    serveSimToken: 'local-test-token',
    serveSimDevice: 'device-B',
    filePath,
    signal: new AbortController().signal,
    logger,
  });
  expect(streamRequest).toEqual({
    url: '/logs?envelope=true&scope=user-apps&device=device-B',
    authorization: 'Bearer local-test-token',
  });
  expect(result).toEqual({
    receivedData: true,
    limitReached: false,
    bytesWritten: expected.length,
    lastSequence: 7,
  });
  expect(await readFile(filePath)).toEqual(expected);

  const mutation = jest.fn().mockReturnValue({
    toPromise: async () => ({
      data: {
        deviceRunSession: {
          createArtifactUploadSession: {
            uploadSession: {
              url: `${baseUrl}/upload`,
              headers: { 'Content-Length': String(expected.length) },
            },
          },
        },
      },
    }),
  });
  await uploadServeSimLogsFileAsync(
    { graphqlClient: { mutation } } as unknown as CustomBuildContext,
    { deviceRunSessionId: 'session-test', udid: 'device-B', filePath, logger }
  );
  expect(mutation.mock.calls[0][1]).toEqual({
    deviceRunSessionId: 'session-test',
    input: {
      name: 'App logs (device-B)',
      filename: 'app-logs.ndjson',
      kind: 'simulator-log',
      metadata: {
        __eas_type: 'simulator-log',
        udid: 'device-B',
        scope: 'user-apps',
        source: 'serve-sim/logs',
      },
      size: expected.length,
    },
  });
  expect(uploaded).toEqual(expected);
  expect(uploadedLength).toBe(String(expected.length));
  expect(logger.warn).not.toHaveBeenCalled();
});

it('resumes a buffered stream without appending already persisted sequence numbers', async () => {
  const urls: string[] = [];
  const first = JSON.stringify({ eventMessage: 'first' });
  const second = JSON.stringify({ eventMessage: 'second' });
  const frame = (seq: number, raw: string): string =>
    `data: ${JSON.stringify({ seq, at: seq * 1000, raw })}\n\n`;
  server.on('request', (request, response) => {
    urls.push(request.url!);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'X-Serve-Sim-Log-Scope': 'user-apps',
    });
    // Deliberately resend seq=1 on reconnect to exercise the client's guard too.
    response.end(frame(1, first) + (urls.length > 1 ? frame(2, second) : ''));
  });
  const filePath = path.join(directory, 'resumed.ndjson');
  const options = {
    serveSimUrl: baseUrl,
    serveSimDevice: 'device-A',
    filePath,
    signal: new AbortController().signal,
    logger,
  };
  const initial = await streamServeSimLogsToFileAsync(options);
  const resumed = await streamServeSimLogsToFileAsync({
    ...options,
    since: initial.lastSequence,
  });
  expect(initial.lastSequence).toBe(1);
  expect(resumed.lastSequence).toBe(2);
  expect(resumed.bytesWritten).toBe(Buffer.byteLength(second + '\n'));
  expect(urls).toEqual([
    '/logs?envelope=true&scope=user-apps&device=device-A',
    '/logs?envelope=true&scope=user-apps&since=1&device=device-A',
  ]);
  expect(await readFile(filePath, 'utf8')).toBe(first + '\n' + second + '\n');
});

it('aborts a real open HTTP stream without waiting for the server to finish', async () => {
  const controller = new AbortController();
  let sawRequest: () => void = () => {};
  const requestStarted = new Promise<void>(resolve => (sawRequest = resolve));
  server.on('request', (_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'X-Serve-Sim-Log-Scope': 'user-apps',
    });
    response.write(': heartbeat\n\n');
    sawRequest();
  });
  const streaming = streamServeSimLogsToFileAsync({
    serveSimUrl: baseUrl,
    filePath: path.join(directory, 'aborted.ndjson'),
    signal: controller.signal,
    logger,
  });
  await requestStarted;
  controller.abort();
  await expect(streaming).resolves.toEqual({
    receivedData: false,
    limitReached: false,
    bytesWritten: 0,
  });
});
