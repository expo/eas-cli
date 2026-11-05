import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs, { type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { Sentry } from '../../sentry';
import {
  AndroidEmulatorLogCapture,
  MAX_ANDROID_LOG_BYTES_PER_SOURCE,
} from '../androidEmulatorLogCapture';

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

async function record(
  capture: AndroidEmulatorLogCapture,
  file: string,
  text: string
): Promise<void> {
  const input = Readable.from([Buffer.from(text)]);
  capture.attach(input, file, 'emulator-output');
  await once(input, 'end');
  await capture.finishFileAsync(file);
}

async function waitForSize(file: string, size: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while ((await fs.stat(file)).size !== size && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect((await fs.stat(file)).size).toBe(size);
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

it('keeps the newest bytes of a source across launches, with independent budgets for the two sources', async () => {
  const capture = new AndroidEmulatorLogCapture(10);
  const first = path.join(directory, 'first.log');
  const retry = path.join(directory, 'retry.log');
  const device = path.join(directory, 'logcat.log');
  await record(capture, first, 'first!');
  await record(capture, retry, 'second!!');
  const logcat = Readable.from([Buffer.from('device logs are separate')]);
  capture.attach(logcat, device, 'device-logcat');
  await once(logcat, 'end');
  // A partially evicted file keeps its size on disk until it is sealed.
  expect((await fs.stat(first)).size).toBe(6);
  const logs = await capture.finishAsync();
  expect(logs).toEqual([
    { filePath: first, source: 'emulator-output', bytesSeen: 6 },
    { filePath: retry, source: 'emulator-output', bytesSeen: 8 },
    { filePath: device, source: 'device-logcat', bytesSeen: 24 },
  ]);
  // The retry evicts the head of the earlier launch; its own tail stays whole.
  expect(await fs.readFile(first, 'utf8')).toBe('t!');
  expect(await fs.readFile(retry, 'utf8')).toBe('second!!');
  expect(await fs.readFile(device, 'utf8')).toBe('e separate');
});

it('frees a finished file on disk once a later launch evicts all of it', async () => {
  const capture = new AndroidEmulatorLogCapture(10);
  const first = path.join(directory, 'first.log');
  const retry = path.join(directory, 'retry.log');
  await record(capture, first, 'first!');
  const input = new PassThrough();
  capture.attach(input, retry, 'emulator-output');
  input.write('second log is too long');
  await waitForSize(first, 0);
  await capture.finishAsync();
  expect(await fs.readFile(first, 'utf8')).toBe('');
  expect(await fs.readFile(retry, 'utf8')).toBe('s too long');
});

it('frees a fully evicted live capture on disk and records its later output', async () => {
  const capture = new AndroidEmulatorLogCapture(10);
  const first = path.join(directory, 'first.log');
  const second = path.join(directory, 'second.log');
  const a = new PassThrough();
  const b = new PassThrough();
  capture.attach(a, first, 'emulator-output');
  capture.attach(b, second, 'emulator-output');
  // Wait between writes: two streams deliver their first chunks in either order.
  a.write('0123456789');
  await waitForSize(first, 10);
  b.write('abcdefghij');
  await waitForSize(first, 0);
  await waitForSize(second, 10);
  a.write('xy');
  await capture.finishAsync();
  expect(await fs.readFile(first, 'utf8')).toBe('xy');
  expect(await fs.readFile(second, 'utf8')).toBe('cdefghij');
});

it('closes an uncapped file when its stream finishes', async () => {
  const opened = trackOpenedFiles();
  const capture = new AndroidEmulatorLogCapture(Infinity);
  const file = path.join(directory, 'build.log');
  await record(capture, file, 'ordinary build output');
  expect(opened).toHaveLength(1);
  expect(opened[0].fd).toBe(-1);
  expect(await fs.readFile(file, 'utf8')).toBe('ordinary build output');
  expect(await capture.finishAsync()).toEqual([
    { filePath: file, source: 'emulator-output', bytesSeen: 21 },
  ]);
});

it('closes the file and reports once when sealing fails', async () => {
  const opened = trackOpenedFiles();
  const capture = new AndroidEmulatorLogCapture(10);
  const file = path.join(directory, 'wrapped.log');
  await record(capture, file, '0123456789abcdef');
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

it('keeps the tail of a wrapped ring in order', async () => {
  const capture = new AndroidEmulatorLogCapture(10);
  const file = path.join(directory, 'wrapped.log');
  const input = new PassThrough();
  capture.attach(input, file, 'emulator-output');
  for (const piece of ['0123', '4567', '89ab', 'cdef']) {
    input.write(piece);
  }
  await capture.finishAsync();
  expect(await fs.readFile(file, 'utf8')).toBe('6789abcdef');
});

it('reserves bytes across simultaneous captures and drains after finalization', async () => {
  const capture = new AndroidEmulatorLogCapture(10);
  const a = new PassThrough();
  const b = new PassThrough();
  const first = path.join(directory, 'first.log');
  const second = path.join(directory, 'second.log');
  capture.attach(a, first, 'emulator-output');
  capture.attach(b, second, 'emulator-output');
  a.write('12345678');
  await waitForSize(first, 8);
  b.write('abcdefgh');
  await capture.finishAsync();
  // The least recently written capture gives up its bytes first.
  expect(await fs.readFile(first, 'utf8')).toBe('78');
  expect(await fs.readFile(second, 'utf8')).toBe('abcdefgh');
  a.end('ignored after cleanup');
  b.end('also ignored');
  expect(a.readableFlowing).toBe(true);
  expect(b.readableFlowing).toBe(true);
});

it('drains a real FIFO beyond 20 MiB, retains the tail, and closes after the writer exits', async () => {
  const file = path.join(directory, 'logcat.log');
  const capture = new AndroidEmulatorLogCapture();
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
    const result = await fs.readFile(file);
    expect(result.length).toBe(MAX_ANDROID_LOG_BYTES_PER_SOURCE);
    expect(result.subarray(0, 4).toString()).toBe('xxxx');
    expect(result.subarray(-4).toString()).toBe('\nEND');
    expect(logs).toEqual([
      { filePath: file, source: 'device-logcat', bytesSeen: 64 * 1024 * 1024 + 10 },
    ]);
    await expect(fs.stat(pipe.path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    writer.kill();
    pipe.close();
  }
}, 30_000);

it('uses the original logcat path for ordinary builds without creating a FIFO', async () => {
  const file = path.join(directory, 'build-logcat.log');
  const capture = new AndroidEmulatorLogCapture(Infinity);
  const output = await capture.prepareLogcatOutputAsync(file);
  expect(output.path).toBe(file);
  expect(await fs.readdir(directory)).toEqual([]);
  output.close();
  await output.closed;
  expect(await capture.finishAsync()).toEqual([]);
});

it('closes an unused logcat pipe when the emulator fails to launch', async () => {
  const file = path.join(directory, 'empty.log');
  const capture = new AndroidEmulatorLogCapture();
  const pipe = await capture.prepareLogcatOutputAsync(file);
  pipe.close();
  await pipe.closed;
  await expect(fs.stat(pipe.path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await capture.finishAsync()).toEqual([
    { filePath: file, source: 'device-logcat', bytesSeen: 0 },
  ]);
  expect((await fs.stat(file)).size).toBe(0);
}, 5_000);

it('keeps draining the FIFO after capture finishes while the emulator is alive', async () => {
  const file = path.join(directory, 'live-logcat.log');
  const capture = new AndroidEmulatorLogCapture(10);
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
    expect((await fs.stat(file)).size).toBe(0);
    await expect(fs.stat(output.path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    writer.kill();
    output.close();
    await output.closed;
  }
}, 10_000);

it('reports a disk write failure once and continues draining output', async () => {
  const capture = new AndroidEmulatorLogCapture(10);
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
