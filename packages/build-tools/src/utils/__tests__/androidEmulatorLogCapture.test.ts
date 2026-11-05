import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs, { type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { Sentry } from '../../sentry';
import {
  AndroidEmulatorLogRing,
  MAX_ANDROID_LOG_BYTES_PER_SOURCE,
} from '../androidEmulatorLogCapture';
import { ALL_ANDROID_EMULATOR_LOG_SOURCES } from '../androidEmulatorLogSources';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.mock('../../sentry', () => ({ Sentry: { capture: jest.fn() } }));

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'android-capped-logs-'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

function createCapture(maxBytes?: number): AndroidEmulatorLogRing {
  return new AndroidEmulatorLogRing({ sources: ALL_ANDROID_EMULATOR_LOG_SOURCES, maxBytes });
}

/** `==== <name> <ISO time> ====\n` */
function markerLength(name: string): number {
  return name.length + 36;
}

async function record(
  capture: AndroidEmulatorLogRing,
  file: string,
  text: string,
  source: 'emulator-output' | 'device-logcat' = 'emulator-output'
): Promise<void> {
  const input = Readable.from([Buffer.from(text)]);
  capture.attach(input, file, source);
  await once(input, 'end');
  await capture.finishFileAsync(file);
}

function trackOpenedFiles(): FileHandle[] {
  const opened: FileHandle[] = [];
  const open = fs.open;
  jest.spyOn(fs, 'open').mockImplementation(async (file, flags, mode) => {
    const handle = await open(file, flags, mode);
    opened.push(handle);
    return handle;
  });
  return opened;
}

it('keeps one ring per source across launches and names each launch that wrote', async () => {
  const capture = createCapture(120);
  const emulatorRing = path.join(directory, 'emulator-output.log');
  const logcatRing = path.join(directory, 'device-logcat.log');
  await record(capture, path.join(directory, 'first-emulator.log'), 'first!');
  await record(capture, path.join(directory, 'retry-emulator.log'), 'second!!');
  await record(capture, path.join(directory, 'one-logcat.log'), 'device log', 'device-logcat');
  const logs = await capture.finishAsync();
  const seen = markerLength('first-emulator') + 6 + 1 + markerLength('retry-emulator') + 8;
  expect(logs).toEqual([
    { filePath: emulatorRing, source: 'emulator-output', bytesSeen: seen },
    { filePath: logcatRing, source: 'device-logcat', bytesSeen: markerLength('one-logcat') + 10 },
  ]);
  expect(await fs.readFile(emulatorRing, 'utf8')).toMatch(
    /^==== first-emulator \S+ ====\nfirst!\n==== retry-emulator \S+ ====\nsecond!!$/
  );
  expect(await fs.readFile(logcatRing, 'utf8')).toMatch(/^==== one-logcat \S+ ====\ndevice log$/);
  expect((await fs.readdir(directory)).sort()).toEqual([
    'device-logcat.log',
    'emulator-output.log',
  ]);
});

it('keeps the tail of the final launch when the ring overflows', async () => {
  const capture = createCapture(120);
  await record(capture, path.join(directory, 'first-emulator.log'), 'first!');
  await record(capture, path.join(directory, 'retry-emulator.log'), 'y'.repeat(100));
  const [log] = await capture.finishAsync();
  const result = await fs.readFile(log.filePath, 'utf8');
  expect(result).toHaveLength(120);
  expect(result.endsWith('y'.repeat(100))).toBe(true);
  expect(result).not.toContain('first!');
  expect(log.bytesSeen).toBeGreaterThan(120);
});

it('keeps the tail of a wrapped ring in order', async () => {
  const capture = createCapture(10);
  const file = path.join(directory, 'wrapped.log');
  const input = new PassThrough();
  capture.attach(input, file, 'emulator-output');
  for (const piece of ['0123', '4567', '89ab', 'cdef']) {
    input.write(piece);
  }
  const [log] = await capture.finishAsync();
  expect(await fs.readFile(log.filePath, 'utf8')).toBe('6789abcdef');
});

it('lets overlapping launches of one source share the ring', async () => {
  const capture = createCapture(400);
  const a = new PassThrough();
  const b = new PassThrough();
  capture.attach(a, path.join(directory, 'clone-1.log'), 'emulator-output');
  capture.attach(b, path.join(directory, 'clone-2.log'), 'emulator-output');
  a.write('from clone 1 first\n');
  b.write('from clone 2\n');
  a.write('from clone 1 second\n');
  const [log] = await capture.finishAsync();
  const result = await fs.readFile(log.filePath, 'utf8');
  expect(result).toMatch(/==== clone-1 \S+ ====\n/);
  expect(result).toMatch(/==== clone-2 \S+ ====\n/);
  expect(result).toContain('from clone 2\n');
  expect(result.indexOf('from clone 1 first')).toBeLessThan(result.indexOf('from clone 1 second'));
  expect(result).toHaveLength(log.bytesSeen);
  a.end('ignored after cleanup');
  b.end('also ignored');
  expect(a.readableFlowing).toBe(true);
  expect(b.readableFlowing).toBe(true);
});

it('drains a real FIFO beyond 20 MiB, retains the tail, and closes after the writer exits', async () => {
  const file = path.join(directory, 'logcat.log');
  const capture = createCapture();
  const pipe = await capture.prepareLogcatOutputAsync(file);
  expect((await fs.stat(pipe.path)).isFIFO()).toBe(true);
  const writer = spawn(
    process.execPath,
    [
      '-e',
      `
    const fs = require('node:fs');
    const fd = fs.openSync(process.argv[1], 'w');
    fs.writeSync(fd, 'BEGIN\\n');
    const chunk = Buffer.alloc(64 * 1024, 'x');
    for (let i = 0; i < 1024; i++) {
      let offset = 0;
      while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset);
    }
    fs.writeSync(fd, '\\nEND');
    fs.closeSync(fd);
  `,
      pipe.path,
    ],
    { stdio: 'ignore' }
  );
  try {
    expect(await once(writer, 'close')).toEqual([0, null]);
    pipe.close();
    pipe.close();
    await pipe.closed;
    const logs = await capture.finishAsync();
    const ring = path.join(directory, 'device-logcat.log');
    const result = await fs.readFile(ring);
    expect(result.length).toBe(MAX_ANDROID_LOG_BYTES_PER_SOURCE);
    expect(result.subarray(0, 4).toString()).toBe('xxxx');
    expect(result.subarray(-4).toString()).toBe('\nEND');
    expect(logs).toEqual([
      {
        filePath: ring,
        source: 'device-logcat',
        bytesSeen: 64 * 1024 * 1024 + 10 + markerLength('logcat'),
      },
    ]);
    await expect(fs.stat(pipe.path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    writer.kill();
    pipe.close();
  }
}, 30_000);

it('closes an unused logcat pipe when the emulator fails to launch', async () => {
  const file = path.join(directory, 'empty.log');
  const capture = createCapture();
  const pipe = await capture.prepareLogcatOutputAsync(file);
  pipe.close();
  await pipe.closed;
  await expect(fs.stat(pipe.path)).rejects.toMatchObject({ code: 'ENOENT' });
  const ring = path.join(directory, 'device-logcat.log');
  expect(await capture.finishAsync()).toEqual([
    { filePath: ring, source: 'device-logcat', bytesSeen: 0 },
  ]);
  expect((await fs.stat(ring)).size).toBe(0);
}, 5_000);

it('keeps draining the FIFO after capture finishes while the emulator is alive', async () => {
  const file = path.join(directory, 'live-logcat.log');
  const capture = createCapture(10);
  const output = await capture.prepareLogcatOutputAsync(file);
  const writer = spawn(
    process.execPath,
    [
      '-e',
      `
    const fs = require('node:fs');
    const fd = fs.openSync(process.argv[1], 'w');
    process.stdout.write('ready');
    process.stdin.once('data', () => {
      const chunk = Buffer.alloc(64 * 1024, 'x');
      for (let i = 0; i < 128; i++) {
        let offset = 0;
        while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset);
      }
      fs.closeSync(fd);
      process.stdin.destroy();
    });
  `,
      output.path,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );
  try {
    await once(writer.stdout, 'data');
    await capture.finishAsync();
    writer.stdin.end('go');
    expect(await once(writer, 'close')).toEqual([0, null]);
    output.close();
    await output.closed;
    expect((await fs.stat(path.join(directory, 'device-logcat.log'))).size).toBe(0);
    await expect(fs.stat(output.path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    writer.kill();
    output.close();
    await output.closed;
  }
}, 10_000);

it('reports a disk write failure once and continues draining output', async () => {
  const capture = createCapture(10);
  const input = new PassThrough();
  const file = path.join(directory, 'failed.log');
  const diskError = Object.assign(new Error('full'), { code: 'ENOSPC' });
  jest.spyOn(fs, 'open').mockRejectedValueOnce(diskError);
  capture.attach(input, file, 'emulator-output');
  input.write('first');
  input.write('second');
  await capture.finishAsync();
  input.end('more');
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Failed to write Android diagnostic log',
    diskError,
    expect.anything()
  );
  expect(input.readableFlowing).toBe(true);
});

it('closes the file and reports once when sealing fails', async () => {
  const opened = trackOpenedFiles();
  const capture = createCapture(10);
  await record(capture, path.join(directory, 'wrapped.log'), '0123456789abcdef');
  const diskError = Object.assign(new Error('full'), { code: 'ENOSPC' });
  jest.spyOn(opened[0], 'truncate').mockRejectedValueOnce(diskError);
  await capture.finishAsync();
  expect(opened[0].fd).toBe(-1);
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Failed to write Android diagnostic log',
    diskError,
    expect.anything()
  );
});
