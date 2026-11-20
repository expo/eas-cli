import { z } from 'zod';

import { DisplayRotationSchema } from './deviceRunSessionScreenshotMetadata';
import { type DeviceScreenshot } from './deviceRunSessionPreview';
import { EXPO_DEVICE_HUB_SERVE_EMU_PREFIX } from './previewActivity';

const REQUEST_TIMEOUT_MS = 30_000;
const SCREENSHOT_METADATA_HEADER = 'X-Expo-Screenshot-Metadata';
// expo-device-hub reports this placeholder instead of a serial before it knows the device.
const UNKNOWN_DEVICE = 'no-device-id';

// serve-emu sends `displayRotation: null` when it could not confirm the rotation for the image.
const ScreenshotMetadataSchema = z
  .object({ displayRotation: DisplayRotationSchema })
  .nullish()
  .catch(undefined);

/**
 * Captures Android session previews through serve-emu in expo-device-hub. An automated capture
 * saves no session screenshot artifact, and its metadata header carries the display rotation.
 */
export function createServeEmuPreviewCapture({
  port,
  token,
  device,
}: {
  port: number;
  token: string;
  /** The emulator serial, or expo-device-hub's placeholder when it has none. */
  device: string;
}) {
  const base = `http://127.0.0.1:${port}${EXPO_DEVICE_HUB_SERVE_EMU_PREFIX}/api/screenshot`;
  const headers = { Authorization: `Bearer ${token}` };
  return {
    /**
     * Older serve-emu answers the probe with 405 and would save an artifact for every capture, so
     * any answer other than a listed `automation` option means unsupported.
     */
    async isSupportedAsync(signal: AbortSignal): Promise<boolean> {
      const response = await fetch(base, {
        headers,
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return false;
      }
      let body: { options?: unknown } | null = null;
      try {
        body = JSON.parse(await response.text());
      } catch {
        return false;
      }
      return Array.isArray(body?.options) && body.options.includes('automation');
    },
    async captureAsync(signal: AbortSignal): Promise<DeviceScreenshot> {
      signal.throwIfAborted();
      // An automated capture writes no file on the host, so an abort can close the request.
      const url = new URL(base);
      if (device !== UNKNOWN_DEVICE) {
        url.searchParams.set('device', device);
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ automation: true }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!response.ok) {
        throw new Error(
          `serve-emu screenshot request failed: ${response.status}${await readErrorAsync(response)}`
        );
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/png')) {
        await response.body?.cancel();
        throw new Error(`serve-emu screenshot returned ${contentType || 'no content type'}.`);
      }
      const image = Buffer.from(await response.arrayBuffer());
      signal.throwIfAborted();
      if (image.length === 0) {
        throw new Error('serve-emu screenshot returned an empty image.');
      }
      const displayRotation = readDisplayRotation(response.headers.get(SCREENSHOT_METADATA_HEADER));
      return displayRotation ? { image, displayRotation } : { image };
    },
  };
}

function readDisplayRotation(header: string | null): DeviceScreenshot['displayRotation'] {
  if (!header) {
    return undefined;
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(header);
  } catch {
    return undefined;
  }
  return ScreenshotMetadataSchema.parse(metadata)?.displayRotation ?? undefined;
}

/** serve-emu answers errors with `{ ok: false, error: string }`. */
async function readErrorAsync(response: Response): Promise<string> {
  try {
    const { error } = JSON.parse(await response.text()) as { error?: unknown };
    return typeof error === 'string' ? ` ${error}` : '';
  } catch {
    return '';
  }
}
