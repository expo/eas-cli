import { writeFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  type CapturedDisplayRotation,
  DisplayRotationSchema,
} from './deviceRunSessionScreenshotMetadata';

// expo-device-hub serves serve-emu, which captures Android screenshots, under this prefix.
const SERVE_EMU_PREFIX = '/vendor/serve-emu';
const REQUEST_TIMEOUT_MS = 30_000;
const SCREENSHOT_METADATA_HEADER = 'X-Expo-Screenshot-Metadata';
const MAX_SCREENSHOT_METADATA_HEADER_LENGTH = 1024;

// serve-emu sends `displayRotation: null` when it could not confirm the rotation for the image.
const ScreenshotMetadataHeaderSchema = z
  .object({ displayRotation: DisplayRotationSchema })
  .nullish()
  .catch(undefined);

/**
 * Captures Android session previews through serve-emu's screenshot endpoint. It reports the
 * display rotation and captures the active display of a foldable, which `adb screencap` does not.
 */
export function createExpoDeviceHubPreviewCapture({
  port,
  token,
}: {
  port: number;
  token: string;
}) {
  const request = async (
    path: string,
    init: { method?: string; body?: string; headers?: Record<string, string> },
    signal: AbortSignal
  ): Promise<Response> => {
    const response = await fetch(`http://127.0.0.1:${port}${SERVE_EMU_PREFIX}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`expo-device-hub ${path} request failed: ${response.status}`);
    }
    return response;
  };
  return {
    /**
     * Older Hubs save every capture as a user screenshot, so they must not take previews. Only a
     * Hub that reports `screenshot.automation` in `GET /api` can skip that.
     */
    async isSupportedAsync(signal: AbortSignal): Promise<boolean> {
      const response = await request('/api', {}, signal);
      const info: { screenshot?: { automation?: unknown } } | null = await response.json();
      return info?.screenshot?.automation === true;
    },
    async captureAsync(destination: string, signal: AbortSignal): Promise<CapturedDisplayRotation> {
      const response = await request(
        '/api/screenshot',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ automation: true }),
        },
        signal
      );
      await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
      const displayRotation = readDisplayRotation(response.headers.get(SCREENSHOT_METADATA_HEADER));
      return displayRotation ? { displayRotation } : {};
    },
  };
}

/** Optional metadata never fails the preview: a missing or invalid header means no rotation. */
function readDisplayRotation(header: string | null): CapturedDisplayRotation['displayRotation'] {
  if (!header || header.length > MAX_SCREENSHOT_METADATA_HEADER_LENGTH) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(header);
  } catch {
    return undefined;
  }
  return ScreenshotMetadataHeaderSchema.parse(value)?.displayRotation ?? undefined;
}
