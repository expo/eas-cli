import { bunyan } from '@expo/logger';
import fetch from 'node-fetch';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { Sentry } from '../../../sentry';
import {
  ServeSimMetricsRecorder,
  readServeSimServersAsync,
  streamServeSimMetricsToFileAsync,
} from '../serveSimMetricsRecorder';

jest.mock('../../../sentry');
jest.mock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

function createLoggerMock(): bunyan {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as bunyan;
}

const SSE_STREAM = [
  'event: meta',
  'data: {"schemaVersion":1,"udid":"U","hostCores":8,"sampleIntervalMs":1000}',
  '',
  ': heartbeat',
  '',
  'data: {"t":1000,"bundleId":"dev.expo.MyApp","cpuPct":0,"memBytes":100}',
  '',
  'data: {"t":2000,"bundleId":"dev.expo.MyApp","cpuPct":40,"memBytes":120}',
  '',
].join('\n');

const EXPECTED_NDJSON =
  '{"schemaVersion":1,"udid":"U","hostCores":8,"sampleIntervalMs":1000}\n' +
  '{"t":1000,"bundleId":"dev.expo.MyApp","cpuPct":0,"memBytes":100}\n' +
  '{"t":2000,"bundleId":"dev.expo.MyApp","cpuPct":40,"memBytes":120}\n';

function sseResponse(): InstanceType<typeof Response> {
  return new Response(Readable.from([Buffer.from(SSE_STREAM)]));
}

let workDir: string;
let stateDir: string;

beforeEach(async () => {
  jest.mocked(fetch).mockReset();
  workDir = await mkdtemp(path.join(os.tmpdir(), 'serve-sim-metrics-rec-test-'));
  stateDir = path.join(workDir, 'serve-sim-state');
});

afterEach(async () => {
  await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() });
  await rm(workDir, { recursive: true, force: true });
});

async function writeServerStateAsync(
  udid: string,
  value: unknown = { pid: 1, port: 4000, device: udid, url: 'https://sim.example' }
): Promise<void> {
  await writeFile(path.join(stateDir, `server-${udid}.json`), JSON.stringify(value));
}

describe(readServeSimServersAsync, () => {
  beforeEach(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateDir, { recursive: true });
  });

  it('returns each server-*.json with a device + url, ignoring other files', async () => {
    await writeServerStateAsync('A', { device: 'A', url: 'http://127.0.0.1:1' });
    await writeServerStateAsync('B', { device: 'B', url: 'http://127.0.0.1:2' });
    await writeFile(path.join(stateDir, 'not-a-server.json'), '{"device":"X","url":"http://x"}');

    const servers = await readServeSimServersAsync(stateDir);
    expect(servers).toEqual(
      expect.arrayContaining([
        { udid: 'A', url: 'http://127.0.0.1:1' },
        { udid: 'B', url: 'http://127.0.0.1:2' },
      ])
    );
    expect(servers).toHaveLength(2);
  });

  it('tolerates malformed/incomplete state files', async () => {
    await writeFile(path.join(stateDir, 'server-bad.json'), 'not json');
    await writeServerStateAsync('C', { device: 'C' }); // missing url
    await writeServerStateAsync('D', { device: 'D', url: 'http://127.0.0.1:4' });

    expect(await readServeSimServersAsync(stateDir)).toEqual([
      { udid: 'D', url: 'http://127.0.0.1:4' },
    ]);
  });

  it('returns [] when the state dir does not exist', async () => {
    expect(await readServeSimServersAsync(path.join(workDir, 'nope'))).toEqual([]);
  });
});

describe(streamServeSimMetricsToFileAsync, () => {
  it('appends the data payloads to the file as NDJSON, ignoring event/heartbeat lines', async () => {
    jest.mocked(fetch).mockResolvedValue(sseResponse());
    const filePath = path.join(workDir, 'stream.ndjson');
    await streamServeSimMetricsToFileAsync({
      serveSimUrl: 'https://sim.example',
      filePath,
      signal: new AbortController().signal,
      logger: createLoggerMock(),
    });
    expect(await readFile(filePath, 'utf-8')).toBe(EXPECTED_NDJSON);
    expect(String(jest.mocked(fetch).mock.calls[0][0])).toBe('https://sim.example/metrics');
  });

  it('writes nothing on a non-ok response', async () => {
    jest.mocked(fetch).mockResolvedValue(new Response('nope', { status: 502 }));
    const filePath = path.join(workDir, 'empty.ndjson');
    await streamServeSimMetricsToFileAsync({
      serveSimUrl: 'https://sim.example',
      filePath,
      signal: new AbortController().signal,
      logger: createLoggerMock(),
    });
    expect(await readFile(filePath, 'utf-8')).toBe('');
  });

  it('warns when the output file emits a write error', async () => {
    const fakeFile = Object.assign(new EventEmitter(), {
      write: jest.fn(),
      end: (cb: () => void) => cb(),
    });
    const fs = jest.requireMock<typeof import('node:fs')>('node:fs');
    const realCreateWriteStream = fs.createWriteStream;
    fs.createWriteStream = (() => {
      queueMicrotask(() => fakeFile.emit('error', new Error('disk full')));
      return fakeFile as unknown as ReturnType<typeof realCreateWriteStream>;
    }) as typeof realCreateWriteStream;
    jest.mocked(fetch).mockResolvedValue(new Response('nope', { status: 502 }));
    const logger = createLoggerMock();

    try {
      await streamServeSimMetricsToFileAsync({
        serveSimUrl: 'https://sim.example',
        filePath: path.join(workDir, 'unwritable.ndjson'),
        signal: new AbortController().signal,
        logger,
      });
    } finally {
      fs.createWriteStream = realCreateWriteStream;
    }

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('file write failed')
    );
  });

  it('warns without throwing when the request errors', async () => {
    jest.mocked(fetch).mockRejectedValue(new Error('ECONNRESET'));
    const filePath = path.join(workDir, 'errored.ndjson');
    const logger = createLoggerMock();
    await expect(
      streamServeSimMetricsToFileAsync({
        serveSimUrl: 'https://sim.example',
        filePath,
        signal: new AbortController().signal,
        logger,
      })
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('stream ended')
    );
  });
});

describe('ServeSimMetricsRecorder', () => {
  it('discovers running servers and collects a per-device NDJSON file', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateDir, { recursive: true });
    await writeServerStateAsync('AAAA', { device: 'AAAA', url: 'https://sim-a.example' });
    jest.mocked(fetch).mockResolvedValue(sseResponse());

    await ServeSimMetricsRecorder.startAsync({ logger: createLoggerMock(), stateDir });
    await delay(200);

    const collected = await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() });
    expect(collected).toHaveLength(1);
    expect(collected[0].udid).toBe('AAAA');
    expect(await readFile(collected[0].filePath, 'utf-8')).toBe(EXPECTED_NDJSON);
  });

  it('reconnects a device whose first /metrics attempt fails', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateDir, { recursive: true });
    await writeServerStateAsync('CCCC', { device: 'CCCC', url: 'https://sim-c.example' });
    jest
      .mocked(fetch)
      .mockResolvedValueOnce(new Response('nope', { status: 502 }))
      .mockImplementation(async () => sseResponse());

    await ServeSimMetricsRecorder.startAsync({
      logger: createLoggerMock(),
      stateDir,
      pollIntervalMs: 20,
    });
    await delay(200);

    const collected = await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() });
    expect(collected).toHaveLength(1);
    // The 502 didn't permanently stop collection — a later attempt recovered samples.
    expect(await readFile(collected[0].filePath, 'utf-8')).toContain('"cpuPct"');
  });

  it('returns [] from finishAsync when nothing is running', async () => {
    expect(await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() })).toEqual([]);
  });

  it('defaults to the serve-sim state dir when none is given', async () => {
    // No state dir exists at the default location, so there is nothing to collect.
    await ServeSimMetricsRecorder.startAsync({ logger: createLoggerMock() });
    expect(await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() })).toEqual([]);
  });

  it('stops reconnecting a device after the per-attempt cap', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateDir, { recursive: true });
    await writeServerStateAsync('DDDD', { device: 'DDDD', url: 'https://sim-d.example' });
    // Every attempt fails fast, freeing the slot so the poller keeps retrying until the cap.
    jest.mocked(fetch).mockResolvedValue(new Response('nope', { status: 502 }));

    await ServeSimMetricsRecorder.startAsync({
      logger: createLoggerMock(),
      stateDir,
      pollIntervalMs: 5,
    });
    await delay(200);
    await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() });

    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(10);
  });

  it('skips a device already streaming and aborts it on finish', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateDir, { recursive: true });
    await writeServerStateAsync('EEEE', { device: 'EEEE', url: 'https://sim-e.example' });
    // A stream that stays open across several poll ticks, so finish has an active stream to abort.
    jest.mocked(fetch).mockImplementation(async () => {
      const stream = new Readable({ read() {} });
      stream.push(Buffer.from('data: {"t":1,"cpuPct":1,"memBytes":1}\n\n'));
      setTimeout(() => stream.push(null), 80).unref();
      return new Response(stream);
    });

    await ServeSimMetricsRecorder.startAsync({
      logger: createLoggerMock(),
      stateDir,
      pollIntervalMs: 5,
    });
    await delay(30);
    const collected = await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() });

    expect(collected).toHaveLength(1);
    // Only one stream was opened despite many poll ticks — the rest were skipped as already active.
    expect(jest.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('reports an unexpected poller error to Sentry', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateDir, { recursive: true });
    await writeServerStateAsync('FFFF', { device: 'FFFF', url: 'https://sim-f.example' });
    jest.mocked(fetch).mockResolvedValue(sseResponse());
    const logger = createLoggerMock();
    jest.mocked(logger.info).mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('Collecting')) {
        throw new Error('boom');
      }
    });

    await ServeSimMetricsRecorder.startAsync({ logger, stateDir, pollIntervalMs: 5 });
    await delay(50);
    await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() });

    expect(Sentry.capture).toHaveBeenCalledWith(
      'serve-sim metrics poller failed',
      expect.any(Error)
    );
  });

  it('is a no-op when start is called twice (single session)', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(stateDir, { recursive: true });
    await writeServerStateAsync('BBBB', { device: 'BBBB', url: 'https://sim-b.example' });
    jest.mocked(fetch).mockResolvedValue(sseResponse());

    await ServeSimMetricsRecorder.startAsync({ logger: createLoggerMock(), stateDir });
    await ServeSimMetricsRecorder.startAsync({ logger: createLoggerMock(), stateDir });
    await delay(200);

    const collected = await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() });
    expect(collected).toHaveLength(1);
    expect(await ServeSimMetricsRecorder.finishAsync({ logger: createLoggerMock() })).toEqual([]);
  });
});
