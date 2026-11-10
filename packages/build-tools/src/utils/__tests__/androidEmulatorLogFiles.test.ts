import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { Sentry } from '../../sentry';
import { AndroidEmulatorLogFiles } from '../androidEmulatorLogFiles';
import { ALL_ANDROID_EMULATOR_LOG_SOURCES } from '../androidEmulatorLogSources';

jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('fs/promises');
jest.unmock('node:fs/promises');
jest.mock('../../sentry', () => ({ Sentry: { capture: jest.fn() } }));

let directory: string;
beforeEach(async () => {
  directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'android-build-logs-'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.promises.rm(directory, { recursive: true, force: true });
});

function trackWriteStreams(): fs.WriteStream[] {
  const streams: fs.WriteStream[] = [];
  const createWriteStream = fs.createWriteStream;
  jest.spyOn(fs, 'createWriteStream').mockImplementation((file, options) => {
    const stream = createWriteStream(file, options);
    streams.push(stream);
    return stream;
  });
  return streams;
}

it('appends one plain file per launch, closes it when the launch ends, and finalizes nothing', async () => {
  const streams = trackWriteStreams();
  const capture = new AndroidEmulatorLogFiles({ sources: ALL_ANDROID_EMULATOR_LOG_SOURCES });
  const first = path.join(directory, 'first-emulator.log');
  const stdout = Readable.from([Buffer.from('out ')]);
  const stderr = Readable.from([Buffer.from('err')]);
  capture.attach(stdout, first, 'emulator-output');
  capture.attach(stderr, first, 'emulator-output');
  await Promise.all([once(stdout, 'end'), once(stderr, 'end')]);
  await capture.finishFileAsync(first);
  expect(streams).toHaveLength(1);
  expect(streams[0].closed).toBe(true);
  expect(await fs.promises.readFile(first, 'utf8')).toBe('out err');
  const retry = path.join(directory, 'retry-emulator.log');
  const input = Readable.from([Buffer.from('retry')]);
  capture.attach(input, retry, 'emulator-output');
  await once(input, 'end');
  expect(await capture.finishAsync()).toEqual([]);
  expect(streams[1].closed).toBe(true);
  expect((await fs.promises.readdir(directory)).sort()).toEqual([
    'first-emulator.log',
    'retry-emulator.log',
  ]);
});

it('gives the emulator the logcat file itself without creating a FIFO', async () => {
  const capture = new AndroidEmulatorLogFiles({ sources: ['device-logcat'] });
  const file = path.join(directory, 'build-logcat.log');
  const output = await capture.prepareLogcatOutputAsync(file);
  expect(output.path).toBe(file);
  expect(await fs.promises.readdir(directory)).toEqual(['build-logcat.log']);
  output.close();
  await output.closed;
  expect(await capture.finishAsync()).toEqual([]);
});

it('reports a write failure once and keeps draining the emulator', async () => {
  const capture = new AndroidEmulatorLogFiles({ sources: ['emulator-output'] });
  const input = new PassThrough();
  const file = path.join(directory, 'missing-directory', 'failed.log');
  capture.attach(input, file, 'emulator-output');
  input.write('first');
  await capture.finishFileAsync(file);
  input.write('second');
  input.end('more');
  expect(Sentry.capture).toHaveBeenCalledTimes(1);
  expect(Sentry.capture).toHaveBeenCalledWith(
    'Failed to write Android diagnostic log',
    expect.objectContaining({ code: 'ENOENT' }),
    expect.anything()
  );
  expect(input.readableFlowing).toBe(true);
});
