import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createExpoDeviceHubPreviewCapture } from '../expoDeviceHubPreviewCapture';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
const signal = new AbortController().signal;
let fetchMock: jest.SpyInstance;
let directory: string;

beforeEach(async () => {
  fetchMock = jest.spyOn(global, 'fetch');
  directory = await mkdtemp(path.join(os.tmpdir(), 'hub-preview-capture-'));
});

afterEach(async () => {
  fetchMock.mockRestore();
  await rm(directory, { recursive: true, force: true });
});

function screenshotResponse(metadataHeader?: string, status = 200): Response {
  return new Response(new Uint8Array(png), {
    status,
    headers: {
      'Content-Type': 'image/png',
      ...(metadataHeader === undefined ? {} : { 'X-Expo-Screenshot-Metadata': metadataHeader }),
    },
  });
}

describe('isSupportedAsync', () => {
  it.each([
    [{ screenshot: { automation: true } }, true],
    // Hubs older than the automation flag send no `screenshot` field and save every capture.
    [{ serial: 'emulator-5554' }, false],
    [{ screenshot: { automation: 'yes' } }, false],
    [null, false],
  ])('reads the automation capability from GET /api (%j)', async (info, expected) => {
    fetchMock.mockResolvedValueOnce(Response.json(info));
    const capture = createExpoDeviceHubPreviewCapture({ port: 4321, token: 'hub-token' });
    await expect(capture.isSupportedAsync(signal)).resolves.toBe(expected);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/vendor/serve-emu/api',
      expect.objectContaining({ headers: { Authorization: 'Bearer hub-token' } })
    );
  });

  it('rejects when the Hub cannot answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    const capture = createExpoDeviceHubPreviewCapture({ port: 4321, token: 'hub-token' });
    await expect(capture.isSupportedAsync(signal)).rejects.toThrow(
      'expo-device-hub /api request failed: 503'
    );
  });
});

describe('captureAsync', () => {
  it('asks serve-emu for an automated capture and writes the image', async () => {
    fetchMock.mockResolvedValueOnce(
      screenshotResponse(
        JSON.stringify({ width: 1080, height: 2424, displayRotation: 'landscape-left' })
      )
    );
    const capture = createExpoDeviceHubPreviewCapture({ port: 4321, token: 'hub-token' });
    const destination = path.join(directory, 'screen.png');
    await expect(capture.captureAsync(destination, signal)).resolves.toEqual({
      displayRotation: 'landscape-left',
    });
    expect(await readFile(destination)).toEqual(png);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/vendor/serve-emu/api/screenshot',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer hub-token' },
        body: JSON.stringify({ automation: true }),
      })
    );
  });

  it.each([
    [
      'an unconfirmed rotation',
      JSON.stringify({ width: 1080, height: 2424, displayRotation: null }),
    ],
    ['an unknown rotation', JSON.stringify({ displayRotation: 'sideways' })],
    ['invalid JSON', 'not json'],
    ['a JSON value that is not an object', '"portrait"'],
    ['an oversized header', JSON.stringify({ displayRotation: 'portrait', pad: 'x'.repeat(1024) })],
    ['no header', undefined],
  ])('keeps the image and sends no rotation for %s', async (_, header) => {
    fetchMock.mockResolvedValueOnce(screenshotResponse(header));
    const capture = createExpoDeviceHubPreviewCapture({ port: 4321, token: 'hub-token' });
    const destination = path.join(directory, 'screen.png');
    await expect(capture.captureAsync(destination, signal)).resolves.toEqual({});
    expect(await readFile(destination)).toEqual(png);
  });

  it('rejects a failed capture without writing a file', async () => {
    fetchMock.mockResolvedValueOnce(screenshotResponse(undefined, 503));
    const capture = createExpoDeviceHubPreviewCapture({ port: 4321, token: 'hub-token' });
    const destination = path.join(directory, 'screen.png');
    await expect(capture.captureAsync(destination, signal)).rejects.toThrow(
      'expo-device-hub /api/screenshot request failed: 503'
    );
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('passes cancellation to the request', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
        )
    );
    const capture = createExpoDeviceHubPreviewCapture({ port: 4321, token: 'hub-token' });
    const capturing = capture.captureAsync(path.join(directory, 'screen.png'), controller.signal);
    controller.abort(new Error('session stopped'));
    await expect(capturing).rejects.toThrow('session stopped');
  });
});
