import { type bunyan } from '@expo/logger';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { type CustomBuildContext } from '../../../customBuildContext';
import { uploadServeSimCrashesFileAsync } from '../serveSimCrashesArtifacts';
import { ServeSimCrashesRecorder } from '../serveSimCrashesRecorder';

jest.mock('../../../sentry');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.unmock('node-fetch');

const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
let directory: string;
let server: Server;
let baseUrl: string;
const summary = { id: 'crash/a', occurrenceTimes: [{ key: 1 }, { key: 2 }] };
const detail = (key: number) => ({
  record: { id: summary.id, bundleId: 'dev.expo.fixture' },
  occurrence: { key, logTail: ['Hello 서울 🌲'], pid: 123 },
  report: key === 1 ? 'original .ips bytes\n' : null,
  reportError: key === 1 ? null : 'macOS has deleted this report',
});

async function waitFor(read: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await read()) {
      return;
    }
    await delay(10);
  }
  throw new Error('Timed out waiting for crash recording');
}

async function start(): Promise<void> {
  await writeFile(
    path.join(directory, 'server-device-A.json'),
    JSON.stringify({
      device: 'device-A',
      url: baseUrl,
      token: 'test-token',
    })
  );
  await ServeSimCrashesRecorder.startAsync({ logger, stateDir: directory, pollIntervalMs: 10 });
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'crashes-http-test-'));
  server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  const { outputDirectory } = await ServeSimCrashesRecorder.finishAsync();
  if (outputDirectory) {
    await rm(outputDirectory, { recursive: true, force: true });
  }
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

it('reconnects without duplicating occurrences, retains reports and log tails, and uploads exact private bytes', async () => {
  let connections = 0;
  let requests = 0;
  let uploaded: Buffer | undefined;
  let uploadAttempts = 0;
  server.on('request', (request, response) => {
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        uploaded = Buffer.concat(chunks);
        uploadAttempts += 1;
        response.writeHead(uploadAttempts === 1 ? 503 : 200).end();
      });
      return;
    }
    expect(request.headers.authorization).toBe('Bearer test-token');
    const url = new URL(request.url!, baseUrl);
    expect(url.searchParams.get('device')).toBe('device-A');
    if (url.pathname === '/crashes') {
      expect(url.searchParams.get('tail')).toBe('1');
      expect(request.headers.accept).toBe('text/event-stream');
      connections += 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const wire = `data: ${JSON.stringify({ type: 'list', crashes: [summary] })}\r\n\r\n`;
      if (connections === 1) {
        response.end(wire);
      } else {
        response.write(wire);
      }
    } else {
      expect(url.pathname).toBe('/crashes/crash%2Fa');
      requests += 1;
      response.end(JSON.stringify(detail(Number(url.searchParams.get('key')))));
    }
  });
  await start();
  await waitFor(() => connections >= 2);
  await ServeSimCrashesRecorder.stopAsync();
  const { crashes: files } = await ServeSimCrashesRecorder.finishAsync();
  expect(files).toHaveLength(1);
  expect(requests).toBe(2);
  const filePath = files[0].filePath;
  const expected = Buffer.from(JSON.stringify(detail(1)) + '\n' + JSON.stringify(detail(2)) + '\n');
  expect(await readFile(filePath)).toEqual(expected);
  expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  const mutation = jest.fn().mockReturnValue({
    toPromise: async () => ({
      data: {
        deviceRunSession: {
          createArtifactUploadSession: {
            uploadSession: {
              url: baseUrl + '/upload',
              headers: { 'Content-Length': String(expected.length) },
            },
          },
        },
      },
    }),
  });
  await uploadServeSimCrashesFileAsync(
    { graphqlClient: { mutation } } as unknown as CustomBuildContext,
    {
      deviceRunSessionId: 'session-id',
      udid: 'device-A',
      filePath,
      logger,
    }
  );
  expect(uploaded).toEqual(expected);
  expect(uploadAttempts).toBe(2);
  expect(mutation.mock.calls[0][1].input).toMatchObject({
    filename: 'crashes.ndjson',
    kind: 'simulator-crashes',
    metadata: { __eas_type: 'simulator-crashes', udid: 'device-A', source: 'serve-sim/crashes' },
  });
  expect(await ServeSimCrashesRecorder.finishAsync()).toEqual({
    outputDirectory: null,
    crashes: [],
  });
  await rm(path.dirname(filePath), { recursive: true, force: true });
});

it('keeps an in-flight report download alive during stop and waits for its write', async () => {
  let requested = false;
  let finishReport: () => void = () => {};
  server.on('request', (request, response) => {
    if (request.url!.startsWith('/crashes?')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ type: 'crash', record: summary })}\n\n`);
    } else {
      requested = true;
      finishReport = () => response.end(JSON.stringify(detail(1)));
    }
  });
  await start();
  await waitFor(() => requested);
  const stopped = ServeSimCrashesRecorder.stopAsync();
  finishReport();
  await stopped;
  const { crashes: files } = await ServeSimCrashesRecorder.finishAsync();
  expect((await readFile(files[0].filePath, 'utf8')).trim()).toBe(JSON.stringify(detail(1)));
  await rm(path.dirname(files[0].filePath), { recursive: true, force: true });
});

it('closes a rejected stream socket and produces no artifact for an empty session', async () => {
  let closed = false;
  server.on('request', (request, response) => {
    request.socket.on('close', () => {
      closed = true;
    });
    response.writeHead(403).write('unfinished response');
  });
  await start();
  await waitFor(() => closed);
  const collected = await ServeSimCrashesRecorder.finishAsync();
  expect(collected.crashes).toEqual([]);
  expect(collected.outputDirectory).toEqual(expect.any(String));
  await rm(collected.outputDirectory!, { recursive: true, force: true });
  expect(JSON.stringify(jest.mocked(logger.warn).mock.calls)).not.toContain('test-token');
});

it('stops at a complete-record byte limit and keeps earlier reports', async () => {
  let requested = 0;
  server.on('request', (request, response) => {
    if (request.url!.startsWith('/crashes?')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ type: 'list', crashes: [summary] })}\n\n`);
    } else {
      requested += 1;
      response.end(
        JSON.stringify(detail(Number(new URL(request.url!, baseUrl).searchParams.get('key'))))
      );
    }
  });
  await writeFile(
    path.join(directory, 'server-device-A.json'),
    JSON.stringify({ device: 'device-A', url: baseUrl })
  );
  await ServeSimCrashesRecorder.startAsync({
    logger,
    stateDir: directory,
    pollIntervalMs: 10,
    maxBytes: Buffer.byteLength(JSON.stringify(detail(1)) + '\n'),
  });
  await waitFor(() => requested === 2);
  await ServeSimCrashesRecorder.stopAsync();
  const { crashes: files } = await ServeSimCrashesRecorder.finishAsync();
  expect(await readFile(files[0].filePath, 'utf8')).toBe(JSON.stringify(detail(1)) + '\n');
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('reached its limit'));
  await rm(path.dirname(files[0].filePath), { recursive: true, force: true });
});

it('retries a failed detail request by reconnecting and replaying the retained list', async () => {
  let requests = 0;
  server.on('request', (request, response) => {
    if (request.url!.startsWith('/crashes?')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ type: 'list', crashes: [{ ...summary, occurrenceTimes: [{ key: 1 }] }] })}\n\n`
      );
    } else {
      requests += 1;
      if (requests === 1) {
        response.writeHead(503).end();
      } else {
        response.end(JSON.stringify(detail(1)));
      }
    }
  });
  await start();
  await waitFor(() => requests === 2);
  await delay(10);
  const { crashes: files } = await ServeSimCrashesRecorder.finishAsync();
  expect(await readFile(files[0].filePath, 'utf8')).toBe(JSON.stringify(detail(1)) + '\n');
  await rm(path.dirname(files[0].filePath), { recursive: true, force: true });
});
