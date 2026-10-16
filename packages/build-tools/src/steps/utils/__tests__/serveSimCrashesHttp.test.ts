import { type bunyan } from '@expo/logger';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { type Server, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { type CustomBuildContext } from '../../../customBuildContext';
import { uploadServeSimCrashesFileAsync } from '../serveSimCrashesArtifacts';
import { ServeSimCrashesRecorder } from '../serveSimCrashesRecorder';
import * as serveSimServers from '../serveSimMetricsRecorder';

jest.mock('../../../sentry');
jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.unmock('node-fetch');

const fs = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
let directory: string;
let server: Server;
let baseUrl: string;
const summary = { id: 'crash/a', occurrenceTimes: [{ key: 1 }, { key: 2 }] };
const report = (key: number) =>
  JSON.stringify({ app_name: 'Fixture 서울 🌲', incident_id: `INC-${key}` }) +
  '\n' +
  JSON.stringify({ exception: { type: 'EXC_CRASH', signal: 'SIGABRT' }, incident: `INC-${key}` }) +
  '\n';
const detail = (key: number) => ({
  record: { id: summary.id, bundleId: 'dev.expo.fixture' },
  occurrence: { key, incidentId: `INC-${key}`, logTail: ['PRIVATE APP LOG'], pid: 123 },
  report: report(key),
  reportError: null,
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

async function start(maxBytes?: number): Promise<void> {
  await writeFile(
    path.join(directory, 'server-device-A.json'),
    JSON.stringify({
      device: 'device-A',
      url: baseUrl,
      token: 'test-token',
    })
  );
  await ServeSimCrashesRecorder.startAsync({
    logger,
    stateDir: directory,
    pollIntervalMs: 10,
    maxBytes,
  });
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

it('saves recurrences as separate private IPS files and uploads unchanged reports without app logs', async () => {
  let connections = 0;
  let requests = 0;
  const uploaded: Buffer[] = [];
  let uploadAttempts = 0;
  server.on('request', (request, response) => {
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        uploaded.push(Buffer.concat(chunks));
        uploadAttempts += 1;
        response.writeHead(uploadAttempts === 1 ? 503 : 200).end();
      });
      return;
    }
    expect(request.headers.authorization).toBe('Bearer test-token');
    const url = new URL(request.url!, baseUrl);
    expect(url.searchParams.get('device')).toBe('device-A');
    if (url.pathname === '/crashes') {
      expect(url.searchParams.has('tail')).toBe(false);
      expect(request.headers.accept).toBe('text/event-stream');
      connections += 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const initial = { ...summary, occurrenceTimes: [{ key: 1 }] };
      const wire = `data: ${JSON.stringify({ type: 'list', crashes: [initial] })}\r\n\r\n`;
      if (connections === 1) {
        response.end(wire);
      } else {
        response.write(
          wire + `data: ${JSON.stringify({ type: 'recurred', record: summary })}\r\n\r\n`
        );
      }
    } else {
      expect(url.pathname).toBe('/crashes/crash%2Fa');
      requests += 1;
      response.end(JSON.stringify(detail(Number(url.searchParams.get('key')))));
    }
  });
  await start();
  await waitFor(() => requests === 2);
  await ServeSimCrashesRecorder.stopAsync();
  const { crashes: files } = await ServeSimCrashesRecorder.finishAsync();
  expect(files).toHaveLength(2);
  expect(requests).toBe(2);
  const expected = [Buffer.from(report(1)), Buffer.from(report(2))];
  for (const [index, file] of files.entries()) {
    expect(path.extname(file.filePath)).toBe('.ips');
    expect(await readFile(file.filePath)).toEqual(expected[index]);
    expect((await stat(file.filePath)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(file.filePath))).mode & 0o777).toBe(0o700);
  }
  expect(files[0].filePath).not.toBe(files[1].filePath);
  const mutation = jest.fn().mockReturnValue({
    toPromise: async () => ({
      data: {
        deviceRunSession: {
          createArtifactUploadSession: {
            uploadSession: {
              url: baseUrl + '/upload',
              headers: {},
            },
          },
        },
      },
    }),
  });
  for (const file of files) {
    await uploadServeSimCrashesFileAsync(
      { graphqlClient: { mutation } } as unknown as CustomBuildContext,
      { deviceRunSessionId: 'session-id', ...file, logger }
    );
  }
  expect(uploaded).toEqual([expected[0], expected[0], expected[1]]);
  expect(uploadAttempts).toBe(3);
  expect(mutation.mock.calls.map(([, { input }]) => input.filename)).toEqual(
    files.map(file => path.basename(file.filePath))
  );
  expect(mutation.mock.calls[0][1].input).toMatchObject({
    kind: 'simulator-crashes',
    metadata: { __eas_type: 'simulator-crashes', udid: 'device-A', source: 'serve-sim/crashes' },
  });
  expect(JSON.stringify(mutation.mock.calls)).not.toContain('PRIVATE APP LOG');
  expect(await ServeSimCrashesRecorder.finishAsync()).toEqual({
    outputDirectory: null,
    crashes: [],
  });
  await rm(path.dirname(files[0].filePath), { recursive: true, force: true });
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
  expect(await readFile(files[0].filePath, 'utf8')).toBe(report(1));
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
    maxBytes: Buffer.byteLength(report(1)),
  });
  await waitFor(() => requested === 2);
  await ServeSimCrashesRecorder.stopAsync();
  const { crashes: files } = await ServeSimCrashesRecorder.finishAsync();
  expect(await readFile(files[0].filePath, 'utf8')).toBe(report(1));
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
  expect(await readFile(files[0].filePath, 'utf8')).toBe(report(1));
  await rm(path.dirname(files[0].filePath), { recursive: true, force: true });
});

it.each([
  ['empty', ''],
  ['heartbeat-only', ': heartbeat\n\n'],
  ['meta-only', `data: ${JSON.stringify({ type: 'meta', meta: { statusError: null } })}\n\n`],
  ['invalid JSON', 'data: {invalid}\n\n'],
  ['invalid frame', 'data: {"type":"list","crashes":false}\n\n'],
])('stops retrying after ten %s streams', async (_name, payload) => {
  let connections = 0;
  server.on('request', (_request, response) => {
    connections += 1;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(payload);
  });
  await start();
  await waitFor(() =>
    jest
      .mocked(logger.warn)
      .mock.calls.some(([message]) =>
        String(message).startsWith('Stopped retrying simulator crash collection')
      )
  );
  await delay(30);
  expect(connections).toBe(10);
  const collected = await ServeSimCrashesRecorder.finishAsync();
  expect(collected.crashes).toEqual([]);
  await rm(collected.outputDirectory!, { recursive: true, force: true });
});

it('keeps retrying streams that process a healthy empty crash list', async () => {
  let connections = 0;
  server.on('request', (_request, response) => {
    connections += 1;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const frame = `data: ${JSON.stringify({ type: 'list', crashes: [] })}\n\n`;
    if (connections < 12) {
      response.end(frame);
    } else {
      response.write(frame);
    }
  });
  await start();
  await waitFor(() => connections === 12);
  expect(
    jest
      .mocked(logger.warn)
      .mock.calls.some(([message]) =>
        String(message).startsWith('Stopped retrying simulator crash collection')
      )
  ).toBe(false);
});

it.each([
  ['keeps retrying while new occurrences are saved', true],
  ['stops after ten retries that only replay a saved occurrence', false],
])('%s before a later detail fails', async (_name, productive) => {
  let connections = 0;
  let failedDetails = 0;
  const keys: number[] = [];
  server.on('request', (request, response) => {
    const url = new URL(request.url!, baseUrl);
    if (url.pathname === '/crashes') {
      connections += 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (productive && connections > 12) {
        response.flushHeaders();
        return;
      }
      const key = productive ? connections : 1;
      response.write(
        `data: ${JSON.stringify({
          type: 'list',
          crashes: [
            { ...summary, occurrenceTimes: [{ key: 1 }, { key }] },
            { id: 'crash/b', occurrenceTimes: [{ key: 1 }] },
          ],
        })}\n\n`
      );
    } else if (url.pathname === '/crashes/crash%2Fb') {
      failedDetails += 1;
      response.writeHead(503).end();
    } else {
      const key = Number(url.searchParams.get('key'));
      keys.push(key);
      response.end(JSON.stringify(detail(key)));
    }
  });
  await start();
  if (productive) {
    await waitFor(() => failedDetails === 12);
    expect(connections).toBeGreaterThanOrEqual(12);
  } else {
    await waitFor(() =>
      jest
        .mocked(logger.warn)
        .mock.calls.some(([message]) =>
          String(message).startsWith('Stopped retrying simulator crash collection')
        )
    );
    expect(connections).toBe(11);
    expect(failedDetails).toBe(11);
  }
  const collected = await ServeSimCrashesRecorder.finishAsync();
  const expectedKeys = Array.from({ length: productive ? 12 : 1 }, (_, index) => index + 1);
  expect(keys).toEqual(expectedKeys);
  expect(collected.crashes).toHaveLength(expectedKeys.length);
  expect(await Promise.all(collected.crashes.map(file => readFile(file.filePath, 'utf8')))).toEqual(
    expectedKeys.map(report)
  );
  await rm(collected.outputDirectory!, { recursive: true, force: true });
});

it('recovers the same server after registry absence without resetting dedupe or the byte budget', async () => {
  let connections = 0;
  let healthy = false;
  let expectAbsence = false;
  let observedAbsence = false;
  const keys: number[] = [];
  const readServers = serveSimServers.readServeSimServersAsync;
  const registry = jest
    .spyOn(serveSimServers, 'readServeSimServersAsync')
    .mockImplementation(async stateDir => {
      const servers = await readServers(stateDir);
      if (expectAbsence && servers.length === 0) {
        observedAbsence = true;
      }
      return servers;
    });
  server.on('request', (request, response) => {
    const url = new URL(request.url!, baseUrl);
    if (url.pathname === '/crashes') {
      connections += 1;
      if (connections > 1 && !healthy) {
        response.writeHead(503).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const record = {
        ...summary,
        occurrenceTimes: healthy ? [{ key: 1 }, { key: 2 }, { key: 3 }] : [{ key: 1 }],
      };
      const frame = `data: ${JSON.stringify({ type: 'list', crashes: [record] })}\n\n`;
      if (healthy) {
        response.write(frame);
      } else {
        response.end(frame);
      }
    } else {
      const key = Number(url.searchParams.get('key'));
      keys.push(key);
      response.end(JSON.stringify(detail(key)));
    }
  });
  try {
    const expected = report(1) + report(2);
    await start(Buffer.byteLength(expected));
    await waitFor(() =>
      jest
        .mocked(logger.warn)
        .mock.calls.some(([message]) =>
          String(message).startsWith('Stopped retrying simulator crash collection')
        )
    );
    expect(connections).toBe(11);
    expectAbsence = true;
    await rm(path.join(directory, 'server-device-A.json'));
    await waitFor(() => observedAbsence);
    healthy = true;
    await writeFile(
      path.join(directory, 'server-device-A.json'),
      JSON.stringify({
        device: 'device-A',
        url: baseUrl,
        token: 'test-token',
      })
    );
    await waitFor(() => keys.includes(3));
    const collected = await ServeSimCrashesRecorder.finishAsync();
    expect(connections).toBe(12);
    expect(keys).toEqual([1, 2, 3]);
    expect(collected.crashes).toHaveLength(2);
    expect(
      (await Promise.all(collected.crashes.map(file => readFile(file.filePath, 'utf8')))).join('')
    ).toBe(expected);
    await rm(collected.outputDirectory!, { recursive: true, force: true });
  } finally {
    registry.mockRestore();
  }
});

it('closes a stalled upload within its budget and lets another device upload', async () => {
  const firstFile = path.join(directory, 'A.ips');
  const secondFile = path.join(directory, 'B.ips');
  await writeFile(firstFile, report(1));
  const expected = Buffer.from(report(2));
  await writeFile(secondFile, expected);
  let firstClosed = false;
  let firstRequests = 0;
  let uploaded: Buffer | undefined;
  server.on('request', (request, response) => {
    if (request.url === '/stalled') {
      firstRequests += 1;
      response.on('close', () => {
        firstClosed = true;
      });
      request.resume();
    } else {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        uploaded = Buffer.concat(chunks);
        response.end();
      });
    }
  });
  let sessions = 0;
  const mutation = jest.fn().mockImplementation(() => ({
    toPromise: async () => ({
      data: {
        deviceRunSession: {
          createArtifactUploadSession: {
            uploadSession: {
              url: baseUrl + (sessions++ === 0 ? '/stalled' : '/upload'),
              headers: {},
            },
          },
        },
      },
    }),
  }));
  const context = { graphqlClient: { mutation } } as unknown as CustomBuildContext;
  await uploadServeSimCrashesFileAsync(context, {
    deviceRunSessionId: 'session-id',
    udid: 'A',
    filePath: firstFile,
    logger,
    signal: AbortSignal.timeout(50),
  });
  await waitFor(() => firstClosed);
  expect(firstRequests).toBe(1);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.any(Object),
    'Could not upload simulator crashes for A; other artifacts will continue.'
  );
  await uploadServeSimCrashesFileAsync(context, {
    deviceRunSessionId: 'session-id',
    udid: 'B',
    filePath: secondFile,
    logger,
    signal: AbortSignal.timeout(1_000),
  });
  expect(mutation).toHaveBeenCalledTimes(2);
  expect(uploaded).toEqual(expected);
});

it.each([null, ''])(
  'does not create an artifact when the native report is %s',
  async nativeReport => {
    let requested = false;
    server.on('request', (request, response) => {
      if (request.url!.startsWith('/crashes?')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write(
          `data: ${JSON.stringify({ type: 'list', crashes: [{ ...summary, occurrenceTimes: [{ key: 1 }] }] })}\n\n`
        );
      } else {
        requested = true;
        response.end(
          JSON.stringify({ ...detail(1), report: nativeReport, reportError: 'Report unavailable' })
        );
      }
    });
    await start();
    await waitFor(() => requested);
    const collected = await ServeSimCrashesRecorder.finishAsync();
    expect(collected.crashes).toEqual([]);
    expect(await readdir(collected.outputDirectory!)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('has no native report'));
    await rm(collected.outputDirectory!, { recursive: true, force: true });
  }
);

it('does not duplicate a saved incident when the server identity changes', async () => {
  let connections = 0;
  let requested = 0;
  server.on('request', (request, response) => {
    if (request.url!.startsWith('/crashes?')) {
      connections += 1;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ type: 'list', crashes: [{ ...summary, occurrenceTimes: [{ key: 1 }] }] })}\n\n`
      );
    } else {
      requested += 1;
      response.end(JSON.stringify(detail(1)));
    }
  });
  await start();
  await waitFor(() => connections >= 2);
  await writeFile(
    path.join(directory, 'server-device-A.json'),
    JSON.stringify({
      device: 'device-A',
      url: baseUrl,
      token: 'new-token',
    })
  );
  await waitFor(() => requested === 2);
  const collected = await ServeSimCrashesRecorder.finishAsync();
  expect(collected.crashes).toHaveLength(1);
  expect(await readFile(collected.crashes[0].filePath, 'utf8')).toBe(report(1));
  await rm(collected.outputDirectory!, { recursive: true, force: true });
});

it('removes a partial file before retrying a failed write', async () => {
  const write = fs.writeFile;
  let attempted = 0;
  let partialFile: string | undefined;
  const writing = jest.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
    if (String(file).endsWith('.ips') && attempted++ === 0) {
      partialFile = String(file);
      await write(file, 'partial report', options);
      throw new Error('disk write failed');
    }
    await write(file, data, options);
  });
  server.on('request', (request, response) => {
    if (request.url!.startsWith('/crashes?')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ type: 'list', crashes: [{ ...summary, occurrenceTimes: [{ key: 1 }] }] })}\n\n`
      );
    } else {
      response.end(JSON.stringify(detail(1)));
    }
  });
  try {
    await start();
    await waitFor(() => attempted >= 2);
    const collected = await ServeSimCrashesRecorder.finishAsync();
    expect(collected.crashes).toHaveLength(1);
    expect(await readdir(collected.outputDirectory!)).toEqual([
      path.basename(collected.crashes[0].filePath),
    ]);
    expect(collected.crashes[0].filePath).not.toBe(partialFile);
    expect(await readFile(collected.crashes[0].filePath, 'utf8')).toBe(report(1));
    await rm(collected.outputDirectory!, { recursive: true, force: true });
  } finally {
    writing.mockRestore();
  }
});

it.each([1_000, 1_001])(
  'keeps the report allowance and deduplicates reconnects after %i missing reports',
  async missingCount => {
    const requested: number[] = [];
    let connections = 0;
    let completed: (() => void) | undefined;
    const processed = new Promise<void>(resolve => {
      completed = resolve;
    });
    const occurrence = (key: number) => ({ ...summary, occurrenceTimes: [{ key }] });
    server.on('request', (request, response) => {
      if (request.url!.startsWith('/crashes?')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        connections += 1;
        if (connections === 1) {
          for (let key = 1; key <= missingCount; key++) {
            response.write(
              `data: ${JSON.stringify({ type: 'recurred', record: occurrence(key) })}\n\n`
            );
          }
        } else {
          const retained = {
            ...summary,
            occurrenceTimes: Array.from({ length: 5 }, (_, index) => ({
              key: missingCount - 4 + index,
            })),
          };
          response.write(`data: ${JSON.stringify({ type: 'list', crashes: [retained] })}\n\n`);
        }
        if (connections < 3) {
          response.end();
        } else {
          response.write(
            `data: ${JSON.stringify({ type: 'recurred', record: occurrence(missingCount + 1) })}\n\n`
          );
        }
      } else {
        const key = Number(new URL(request.url!, baseUrl).searchParams.get('key'));
        requested.push(key);
        response.end(
          JSON.stringify({ ...detail(key), report: key <= missingCount ? null : report(key) })
        );
        if (key === missingCount + 1) {
          completed?.();
        }
      }
    });
    await start();
    await processed;
    const collected = await ServeSimCrashesRecorder.finishAsync();
    try {
      expect(connections).toBe(3);
      expect(requested).toEqual(Array.from({ length: missingCount + 1 }, (_, index) => index + 1));
      expect(collected.crashes).toHaveLength(1);
      expect(await readFile(collected.crashes[0].filePath, 'utf8')).toBe(report(missingCount + 1));
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('reached its limit'));
    } finally {
      await rm(collected.outputDirectory!, { recursive: true, force: true });
    }
  },
  15_000
);

it('reserves one collection directory when started concurrently', async () => {
  const creation = jest.spyOn(fs, 'mkdtemp');
  let directories: string[] = [];
  try {
    const options = { logger, stateDir: directory, pollIntervalMs: 10, maxDurationMs: 50 };
    await Promise.all([
      ServeSimCrashesRecorder.startAsync(options),
      ServeSimCrashesRecorder.startAsync(options),
    ]);
    directories = await Promise.all(
      creation.mock.results.map(async result => String(await result.value))
    );
    await delay(60);
    const collected = await ServeSimCrashesRecorder.finishAsync();
    expect(directories).toHaveLength(1);
    expect(collected.outputDirectory).toBe(directories[0]);
  } finally {
    await ServeSimCrashesRecorder.finishAsync();
    await Promise.all(
      directories.map(directory => rm(directory, { recursive: true, force: true }))
    );
    creation.mockRestore();
  }
});

it('rejects concurrent initialization failures and lets a later start retry', async () => {
  const error = new Error('temporary directory unavailable');
  const creation = jest.spyOn(fs, 'mkdtemp').mockRejectedValueOnce(error);
  let outputDirectory: string | null = null;
  try {
    const options = { logger, stateDir: directory, pollIntervalMs: 10 };
    const results = await Promise.allSettled([
      ServeSimCrashesRecorder.startAsync(options),
      ServeSimCrashesRecorder.startAsync(options),
    ]);
    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    expect(creation).toHaveBeenCalledTimes(1);
    await ServeSimCrashesRecorder.startAsync(options);
    const collected = await ServeSimCrashesRecorder.finishAsync();
    outputDirectory = collected.outputDirectory;
    expect(creation).toHaveBeenCalledTimes(2);
    expect(outputDirectory).not.toBeNull();
    expect(await readdir(outputDirectory!)).toEqual([]);
  } finally {
    const collected = await ServeSimCrashesRecorder.finishAsync();
    for (const directory of new Set([outputDirectory, collected.outputDirectory])) {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
    creation.mockRestore();
  }
});

it('waits for pending initialization before finalizing its directory', async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'crashes-startup-test-'));
  let resolveDirectory: (directory: string) => void = () => {};
  const initialization = new Promise<string>(resolve => {
    resolveDirectory = resolve;
  });
  const creation = jest.spyOn(fs, 'mkdtemp').mockReturnValueOnce(initialization);
  const starting = ServeSimCrashesRecorder.startAsync({ logger, stateDir: directory });
  let finished = false;
  const finishing = ServeSimCrashesRecorder.finishAsync().then(collected => {
    finished = true;
    return collected;
  });
  try {
    await delay(10);
    expect(finished).toBe(false);
    resolveDirectory(outputDirectory);
    await starting;
    await expect(finishing).resolves.toEqual({ outputDirectory, crashes: [] });
  } finally {
    resolveDirectory(outputDirectory);
    await Promise.allSettled([starting, finishing]);
    await rm(outputDirectory, { recursive: true, force: true });
    creation.mockRestore();
  }
});

it('does not let a failed initialization finalizer clear its replacement', async () => {
  const error = new Error('temporary directory unavailable');
  let rejectDirectory: (error: Error) => void = () => {};
  const initialization = new Promise<string>((_resolve, reject) => {
    rejectDirectory = reject;
  });
  const creation = jest.spyOn(fs, 'mkdtemp').mockReturnValueOnce(initialization);
  const options = { logger, stateDir: directory, pollIntervalMs: 10, maxDurationMs: 50 };
  const starting = ServeSimCrashesRecorder.startAsync(options);
  const finishing = ServeSimCrashesRecorder.finishAsync();
  const retried = starting.catch(() => ServeSimCrashesRecorder.startAsync(options));
  let outputDirectory: string | null = null;
  try {
    rejectDirectory(error);
    expect(await Promise.allSettled([starting, finishing, retried])).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: undefined },
    ]);
    const collected = await ServeSimCrashesRecorder.finishAsync();
    outputDirectory = collected.outputDirectory;
    expect(outputDirectory).not.toBeNull();
    expect(creation).toHaveBeenCalledTimes(2);
  } finally {
    await ServeSimCrashesRecorder.finishAsync();
    await delay(60);
    const directories = await Promise.allSettled(creation.mock.results.map(result => result.value));
    for (const result of directories) {
      if (result.status === 'fulfilled') {
        await rm(String(result.value), { recursive: true, force: true });
      }
    }
    creation.mockRestore();
  }
});
