import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runServeSimActionWithResultAsync } from '../serveSimActions';
import { createServeSimPreviewCapture } from '../serveSimPreviewCapture';

jest.mock('../serveSimActions');

const signal = new AbortController().signal;
const tmpdir = path.join(os.tmpdir(), 'host-tmp');
const staging = path.join(tmpdir, 'serve-sim-screenshots');
const destination = path.join(os.tmpdir(), 'screen.png');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
const options = { port: 1234, token: 'host-token', device: 'selected-udid', tmpdir };

beforeEach(async () => {
  await mkdir(staging, { recursive: true });
  jest.mocked(runServeSimActionWithResultAsync).mockReset();
});

it('requires advertised support before using the optional capture mode', async () => {
  const capture = createServeSimPreviewCapture(options);
  jest.mocked(runServeSimActionWithResultAsync).mockResolvedValueOnce('{}');
  await expect(capture.prepareAsync(signal)).rejects.toThrow('does not support');
  expect(runServeSimActionWithResultAsync).toHaveBeenCalledWith({
    port: 1234,
    token: 'host-token',
    action: 'actions.describe',
    params: {},
    timeoutMs: 30_000,
    signal,
  });
  jest.mocked(runServeSimActionWithResultAsync).mockResolvedValueOnce(
    JSON.stringify({
      'screenshot.capture': {
        properties: { copyToDesktop: { type: 'boolean' }, purpose: { const: 'session-preview' } },
      },
    })
  );
  await capture.prepareAsync(signal);
});

it('captures the selected active display without Desktop copies and removes only its own staging', async () => {
  await writeFile(path.join(staging, 'unrelated.png'), 'keep');
  jest.mocked(runServeSimActionWithResultAsync).mockImplementation(async request => {
    expect(request).toEqual({
      port: 1234,
      token: 'host-token',
      action: 'screenshot.capture',
      params: {
        udid: 'selected-udid',
        fileName: expect.stringMatching(/^serve-sim-screenshot-preview-.*\.png$/),
        copyToDesktop: false,
        purpose: 'session-preview',
      },
      timeoutMs: 30_000,
      signal,
      drainAfterDispatch: true,
    });
    await writeFile(path.join(staging, request.params.fileName as string), png);
    return '';
  });
  const capture = createServeSimPreviewCapture(options);
  await capture.captureAsync(destination, signal);
  expect(await readFile(destination)).toEqual(png);
  expect(await readdir(staging)).toEqual(['unrelated.png']);
});

it('drains an already sent action before honoring abort and deleting its output', async () => {
  const controller = new AbortController();
  let complete!: () => void;
  const pending = new Promise<void>(resolve => {
    complete = resolve;
  });
  let staged!: string;
  jest.mocked(runServeSimActionWithResultAsync).mockImplementation(async request => {
    staged = path.join(staging, request.params.fileName as string);
    await pending;
    await writeFile(staged, png);
    return '';
  });
  const capture = createServeSimPreviewCapture(options);
  let settled = false;
  const capturing = capture.captureAsync(destination, controller.signal);
  void capturing.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  controller.abort(new Error('session stopped'));
  await Promise.resolve();
  expect(settled).toBe(false);
  complete();
  await expect(capturing).rejects.toThrow('session stopped');
  expect(await readdir(staging)).toEqual([]);
});

it.each(['timed out', 'connection closed'])(
  'keeps a possibly writable file after %s until the host stops',
  async message => {
    let staged!: string;
    jest.mocked(runServeSimActionWithResultAsync).mockImplementation(async request => {
      staged = path.join(staging, request.params.fileName as string);
      await writeFile(staged, 'reservation');
      throw new Error(message);
    });
    const capture = createServeSimPreviewCapture(options);
    await expect(capture.captureAsync(destination, signal)).rejects.toThrow(message);
    expect(await readFile(staged, 'utf8')).toBe('reservation');
    // The server may still write after the client's deadline or disconnect.
    await writeFile(staged, png);
    await capture.cleanupAfterHostStoppedAsync();
    expect(await readdir(staging)).toEqual([]);
  }
);

it('attempts every owned cleanup when one file cannot be removed', async () => {
  let blocked!: string;
  let count = 0;
  jest.mocked(runServeSimActionWithResultAsync).mockImplementation(async request => {
    const staged = path.join(staging, request.params.fileName as string);
    if (count++ === 0) {
      blocked = staged;
      await mkdir(staged);
    } else {
      await writeFile(staged, png);
    }
    throw new Error('capture disconnected');
  });
  const capture = createServeSimPreviewCapture(options);
  await expect(capture.captureAsync(destination, signal)).rejects.toThrow('disconnected');
  await expect(capture.captureAsync(destination, signal)).rejects.toThrow('disconnected');
  await expect(capture.cleanupAfterHostStoppedAsync()).rejects.toThrow(
    'Could not remove preview captures'
  );
  expect(await readdir(staging)).toEqual([path.basename(blocked)]);
});

it('does not send a capture when already aborted', async () => {
  const capture = createServeSimPreviewCapture(options);
  await expect(
    capture.captureAsync(destination, AbortSignal.abort(new Error('stopped')))
  ).rejects.toThrow('stopped');
  expect(runServeSimActionWithResultAsync).not.toHaveBeenCalled();
});
