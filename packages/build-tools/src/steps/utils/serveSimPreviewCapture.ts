import { z } from 'zod';

import { DisplayRotationSchema } from './deviceRunSessionScreenshotMetadata';
import { type IosScreenshot } from './deviceRunSessionPreview';
import {
  captureServeSimScreenshotAsync,
  runServeSimActionWithResultAsync,
} from './serveSimActions';

// serve-sim sends `displayRotation: null` when it could not confirm the rotation for the image.
const ScreenshotMetadataSchema = z
  .object({ displayRotation: DisplayRotationSchema })
  .nullish()
  .catch(undefined);

type ScreenshotCatalog = {
  'screenshot.capture'?: {
    properties?: {
      automation?: { type?: unknown };
      output?: { enum?: unknown; binaryMetadataFrame?: unknown };
    };
  };
} | null;

export function createServeSimPreviewCapture({
  port,
  token,
  device,
}: {
  port: number;
  token: string;
  device: string;
}) {
  // Servers that advertise this flag send a metadata frame after each binary image.
  let binaryMetadataFrame = false;
  return {
    async isSupportedAsync(signal: AbortSignal): Promise<boolean> {
      const { stdout } = await runServeSimActionWithResultAsync({
        port,
        token,
        action: 'actions.describe',
        params: {},
        timeoutMs: 30_000,
        signal,
      });
      const catalog: ScreenshotCatalog = JSON.parse(stdout);
      const properties = catalog?.['screenshot.capture']?.properties;
      const outputs = properties?.output?.enum;
      binaryMetadataFrame = properties?.output?.binaryMetadataFrame === true;
      return (
        properties?.automation?.type === 'boolean' &&
        Array.isArray(outputs) &&
        outputs.includes('binary')
      );
    },
    async captureAsync(signal: AbortSignal): Promise<IosScreenshot> {
      // The exec-ws client drains a sent capture before it honors the abort.
      const { image, metadata } = await captureServeSimScreenshotAsync({
        port,
        token,
        params: { udid: device, automation: true },
        timeoutMs: 30_000,
        signal,
        waitForMetadata: binaryMetadataFrame,
      });
      signal.throwIfAborted();
      const displayRotation = ScreenshotMetadataSchema.parse(metadata)?.displayRotation;
      return displayRotation ? { image, displayRotation } : { image };
    },
  };
}
