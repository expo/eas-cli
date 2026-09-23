import { type bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { ServeSimLogsRecorder, streamServeSimLogsToFileAsync } from '../serveSimLogsRecorder';

jest.mock('node-fetch');
jest.mock('../../../sentry');
jest.unmock('node:fs');
jest.unmock('node:fs/promises');
const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');
const logger = { info: jest.fn(), warn: jest.fn() } as unknown as bunyan;
let directory: string;

beforeEach(async () => {
  jest.mocked(fetch).mockReset();
  directory = await mkdtemp(path.join(os.tmpdir(), 'logs-test-'));
});

afterEach(async () => {
  const files = await ServeSimLogsRecorder.finishAsync({ logger });
  for (const file of files) {
    await rm(path.dirname(file.filePath), { recursive: true, force: true });
  }
  await rm(directory, { recursive: true, force: true });
});

function record(options: Partial<Parameters<typeof streamServeSimLogsToFileAsync>[0]> = {}) {
  return streamServeSimLogsToFileAsync({
    serveSimUrl: 'http://localhost:1234',
    filePath: path.join(directory, 'logs.ndjson'),
    signal: new AbortController().signal,
    logger,
    ...options,
  });
}

it('preserves split UTF-8 and CRLF records, skips heartbeat and invalid JSON, and selects a device', async () => {
  const input = Buffer.from(
    ':\r\n\r\ndata: {"message":"안녕"}\r\n\r\ndata: bad\n\ndata: {"pid":42}\n\n'
  );
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response(Readable.from([...input].map(byte => Buffer.from([byte])))));
  const result = await record({ serveSimToken: 'secret', serveSimDevice: 'device two' });
  expect(result.receivedData).toBe(true);
  expect(await readFile(path.join(directory, 'logs.ndjson'), 'utf8')).toBe(
    '{"message":"안녕"}\n{"pid":42}\n'
  );
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:1234/logs?envelope=true&device=device+two',
    expect.objectContaining({ headers: { Authorization: 'Bearer secret' } })
  );
});

it('retains completed records when a connection errors', async () => {
  const stream = Readable.from(
    (async function* () {
      yield Buffer.from('data: {"pid":42}\n\n');
      await delay(10);
      throw new Error('disconnect');
    })()
  );
  jest.mocked(fetch).mockResolvedValue(new Response(stream));
  expect(await record()).toEqual({ receivedData: true, bytesWritten: 11, limitReached: false });
  expect(await readFile(path.join(directory, 'logs.ndjson'), 'utf8')).toBe('{"pid":42}\n');
});

it('aborts a quiet live stream and drains preceding writes before returning', async () => {
  const controller = new AbortController();
  const stream = new Readable({ read() {} });
  stream.push('data: {"pid":42}\n\n');
  jest.mocked(fetch).mockResolvedValue(new Response(stream));
  const done = record({ signal: controller.signal });
  await delay(20);
  controller.abort();
  expect((await done).receivedData).toBe(true);
  expect(stream.destroyed).toBe(true);
  expect(await readFile(path.join(directory, 'logs.ndjson'), 'utf8')).toBe('{"pid":42}\n');
});

it('enforces the byte limit without writing a truncated record', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response(Readable.from(['data: {"pid":42}\n\ndata: {"pid":43}\n\n'])));
  expect(await record({ maxBytes: 15 })).toEqual({
    receivedData: true,
    bytesWritten: 11,
    limitReached: true,
  });
  expect(await readFile(path.join(directory, 'logs.ndjson'), 'utf8')).toBe('{"pid":42}\n');
});

it('drops an oversized partial SSE line and resumes at the next complete record', async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(
      new Response(
        Readable.from(['data: ' + 'x'.repeat(1024 * 1024 + 1), 'tail\n\ndata: {"pid":42}\n\n'])
      )
    );
  expect((await record()).bytesWritten).toBe(11);
});

it('warns and resolves on HTTP and file failures', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(new Response('missing', { status: 404 }));
  expect((await record()).receivedData).toBe(false);
  jest.mocked(fetch).mockResolvedValueOnce(new Response(Readable.from(['data: {}\n\n'])));
  expect((await record({ filePath: '/missing-dir/log.ndjson' })).receivedData).toBe(false);
  expect(logger.warn).toHaveBeenCalledTimes(2);
});

async function register(): Promise<string> {
  const stateDir = path.join(directory, 'state');
  await mkdir(stateDir);
  await writeFile(
    path.join(stateDir, 'server-A.json'),
    JSON.stringify({ device: 'A', url: 'http://localhost:1234' })
  );
  return stateDir;
}

it('caps bytes across reconnects and finalizes only once even concurrently', async () => {
  const stateDir = await register();
  let seq = 0;
  jest
    .mocked(fetch)
    .mockImplementation(
      async () =>
        new Response(
          Readable.from([`data: ${JSON.stringify({ seq: ++seq, raw: '{"pid":42}' })}\n\n`])
        )
    );
  await ServeSimLogsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5, maxBytes: 22 });
  await delay(100);
  expect(fetch).toHaveBeenCalledTimes(2);
  const [first, second] = await Promise.all([
    ServeSimLogsRecorder.finishAsync({ logger }),
    ServeSimLogsRecorder.finishAsync({ logger }),
  ]);
  expect(first).toHaveLength(1);
  expect(second).toEqual([]);
  expect(await readFile(first[0].filePath, 'utf8')).toBe('{"pid":42}\n{"pid":42}\n');
  expect(await ServeSimLogsRecorder.finishAsync({ logger })).toEqual([]);
});

it('returns immediately before a server exists and discovers a later registration', async () => {
  const stateDir = path.join(directory, 'state');
  jest.mocked(fetch).mockImplementation(async () => new Response(Readable.from(['data: {}\n\n'])));
  await ServeSimLogsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5 });
  expect(fetch).not.toHaveBeenCalled();
  await register();
  await delay(30);
  expect(await ServeSimLogsRecorder.finishAsync({ logger })).toHaveLength(1);
});

it('stops discovery and active streams at the session time limit', async () => {
  const stateDir = await register();
  const stream = new Readable({ read() {} });
  stream.push('data: {}\n\n');
  jest.mocked(fetch).mockResolvedValue(new Response(stream));
  await ServeSimLogsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5, maxDurationMs: 30 });
  await delay(80);
  expect(stream.destroyed).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await ServeSimLogsRecorder.finishAsync({ logger })).toHaveLength(1);
});

it('stops retrying after ten consecutive failures', async () => {
  const stateDir = await register();
  jest.mocked(fetch).mockImplementation(async () => new Response('bad', { status: 503 }));
  await ServeSimLogsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5 });
  await delay(150);
  expect(fetch).toHaveBeenCalledTimes(10);
  expect(await ServeSimLogsRecorder.finishAsync({ logger })).toEqual([]);
});

it('selects each registered device when two simulators share one server URL', async () => {
  const stateDir = await register();
  await writeFile(
    path.join(stateDir, 'server-B.json'),
    JSON.stringify({ device: 'B', url: 'http://localhost:1234' })
  );
  jest.mocked(fetch).mockImplementation(async () => new Response(Readable.from(['data: {}\n\n'])));
  await ServeSimLogsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5, maxBytes: 3 });
  await delay(50);
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:1234/logs?envelope=true&device=A',
    expect.anything()
  );
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:1234/logs?envelope=true&device=B',
    expect.anything()
  );
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('persists the envelope cursor only for written records and drops replayed sequences', async () => {
  const frames = [1, 2, 3].map(
    seq => `data: ${JSON.stringify({ seq, raw: JSON.stringify({ pid: seq }) })}\n\n`
  );
  jest.mocked(fetch).mockResolvedValue(new Response(Readable.from(frames)));
  expect(await record({ since: 1, maxBytes: 10 })).toEqual({
    receivedData: true,
    bytesWritten: 10,
    limitReached: true,
    lastSequence: 2,
  });
  expect(await readFile(path.join(directory, 'logs.ndjson'), 'utf8')).toBe('{"pid":2}\n');
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:1234/logs?envelope=true&since=1',
    expect.anything()
  );
});

it('does not reconnect a legacy data stream without a replay cursor', async () => {
  const stateDir = await register();
  jest.mocked(fetch).mockImplementation(async () => new Response(Readable.from(['data: {}\n\n'])));
  await ServeSimLogsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5 });
  await delay(50);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('without a replay cursor'));
});

it('resets the replay cursor when a replacement server changes its token', async () => {
  const stateDir = await register();
  let calls = 0;
  jest.mocked(fetch).mockImplementation(async (_url, options) => {
    calls++;
    if (calls === 1) {
      await writeFile(
        path.join(stateDir, 'server-A.json'),
        JSON.stringify({
          device: 'A',
          url: 'http://localhost:1234',
          token: 'new-token',
        })
      );
    }
    const seq = options?.headers ? 1 : 50;
    return new Response(Readable.from([`data: ${JSON.stringify({ seq, raw: '{}' })}\n\n`]));
  });
  await ServeSimLogsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5, maxBytes: 6 });
  await delay(50);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(jest.mocked(fetch).mock.calls[1][0])).not.toContain('since=');
  expect(jest.mocked(fetch).mock.calls[1][1]?.headers).toEqual({
    Authorization: 'Bearer new-token',
  });
});
