import {
  captureServeSimScreenshotAsync,
  runServeSimActionWithResultAsync,
} from '../serveSimActions';
import { createServeSimPreviewCapture } from '../serveSimPreviewCapture';

jest.mock('../serveSimActions');

const signal = new AbortController().signal;
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
const options = { port: 1234, token: 'host-token', device: 'selected-udid', maxWidth: 320 };
const maxWidth = { type: 'integer', minimum: 1, maximum: 8192 };
// `null` leaves `maxWidth` out, as a server without resized screenshots does.
const catalog = (output: unknown, resize: unknown = maxWidth) => ({
  'screenshot.capture': {
    properties: {
      automation: { type: 'boolean', default: false },
      ...(resize === null ? {} : { maxWidth: resize }),
      output,
    },
  },
});
const binaryWithMetadata = { enum: ['path', 'binary'], default: 'path', binaryMetadataFrame: true };

beforeEach(() => {
  jest.mocked(runServeSimActionWithResultAsync).mockReset();
  jest.mocked(captureServeSimScreenshotAsync).mockReset();
});

async function createSupportedCaptureAsync(
  output: unknown = binaryWithMetadata,
  resize: unknown = maxWidth
) {
  jest
    .mocked(runServeSimActionWithResultAsync)
    .mockResolvedValueOnce({ stdout: JSON.stringify(catalog(output, resize)) });
  const capture = createServeSimPreviewCapture(options);
  await expect(capture.isSupportedAsync(signal)).resolves.toBe(true);
  return capture;
}

it('captures a resized binary image and waits for advertised metadata', async () => {
  jest.mocked(captureServeSimScreenshotAsync).mockResolvedValueOnce({
    image: png,
    metadata: { width: 2556, height: 1179, displayRotation: 'landscape-left' },
  });
  const capture = await createSupportedCaptureAsync();
  await expect(capture.captureAsync(signal)).resolves.toEqual({
    image: png,
    displayRotation: 'landscape-left',
  });
  expect(captureServeSimScreenshotAsync).toHaveBeenCalledWith({
    port: 1234,
    token: 'host-token',
    params: { udid: 'selected-udid', automation: true, maxWidth: 320 },
    timeoutMs: 30_000,
    signal,
    waitForMetadata: true,
  });
});

it('does not wait for a metadata frame that the server does not advertise', async () => {
  jest.mocked(captureServeSimScreenshotAsync).mockResolvedValueOnce({ image: png });
  const capture = await createSupportedCaptureAsync({ enum: ['path', 'binary'] });
  await expect(capture.captureAsync(signal)).resolves.toEqual({ image: png });
  expect(captureServeSimScreenshotAsync).toHaveBeenCalledWith(
    expect.objectContaining({ waitForMetadata: false })
  );
});

it('does not ask for a size that the server does not advertise', async () => {
  jest.mocked(captureServeSimScreenshotAsync).mockResolvedValueOnce({ image: png });
  const capture = await createSupportedCaptureAsync(binaryWithMetadata, null);
  await expect(capture.captureAsync(signal)).resolves.toEqual({ image: png });
  expect(captureServeSimScreenshotAsync).toHaveBeenCalledWith(
    expect.objectContaining({ params: { udid: 'selected-udid', automation: true } })
  );
});

it.each([
  [{ width: 2556, height: 1179, displayRotation: 'landscape-left' }, 'landscape-left'],
  [{ width: 1179, height: 2556, displayRotation: null }, undefined],
  [{ displayRotation: 'sideways' }, undefined],
  ['not metadata', undefined],
  [undefined, undefined],
])('returns only a known display rotation from the metadata (%j)', async (metadata, expected) => {
  jest.mocked(captureServeSimScreenshotAsync).mockResolvedValueOnce({ image: png, metadata });
  const capture = await createSupportedCaptureAsync();
  await expect(capture.captureAsync(signal)).resolves.toEqual(
    expected ? { image: png, displayRotation: expected } : { image: png }
  );
});

it('drops a capture that finishes after abort', async () => {
  const controller = new AbortController();
  jest.mocked(captureServeSimScreenshotAsync).mockImplementationOnce(async () => {
    // The exec-ws client drains a sent capture before it returns.
    controller.abort(new Error('session stopped'));
    return { image: png };
  });
  const capture = await createSupportedCaptureAsync();
  await expect(capture.captureAsync(controller.signal)).rejects.toThrow('session stopped');
});

it('fails the preview when the capture fails', async () => {
  jest
    .mocked(captureServeSimScreenshotAsync)
    .mockRejectedValueOnce(new Error('serve-sim screenshot.capture failed: not booted'));
  const capture = await createSupportedCaptureAsync();
  await expect(capture.captureAsync(signal)).rejects.toThrow('not booted');
});

it.each([
  [catalog(binaryWithMetadata), true],
  [catalog({ enum: ['path', 'binary'] }), true],
  [catalog({ enum: ['path'] }), false],
  [catalog({ type: 'string' }), false],
  [catalog(undefined), false],
  [{ 'screenshot.capture': { properties: { output: binaryWithMetadata } } }, false],
  [
    {
      'screenshot.capture': {
        properties: { automation: { type: 'string' }, output: binaryWithMetadata },
      },
    },
    false,
  ],
  [{ 'screenshot.capture': { properties: {} } }, false],
  [{}, false],
  [null, false],
])(
  'checks the catalog for automation and binary output before enabling captures (%j)',
  async (described, supported) => {
    jest
      .mocked(runServeSimActionWithResultAsync)
      .mockResolvedValueOnce({ stdout: JSON.stringify(described) });
    const capture = createServeSimPreviewCapture(options);
    await expect(capture.isSupportedAsync(signal)).resolves.toBe(supported);
    expect(runServeSimActionWithResultAsync).toHaveBeenCalledWith({
      port: options.port,
      token: options.token,
      action: 'actions.describe',
      params: {},
      timeoutMs: 30_000,
      signal,
    });
    expect(captureServeSimScreenshotAsync).not.toHaveBeenCalled();
  }
);
