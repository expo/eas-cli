import fs from 'fs-extra';
import path from 'path';

import { MetadataEvent } from '../analytics/events';
import { confirmAsync } from '../prompts';
import { AppleData } from './apple/data';
import { createAppleTasks } from './apple/tasks';
import { createAppleWriter } from './config';
import { MetadataContext, ensureMetadataAppStoreAuthenticatedAsync } from './context';
import { MetadataDownloadError, MetadataValidationError } from './errors';
import { subscribeTelemetry } from './utils/telemetry';

/**
 * Generate a local store configuration from the stores.
 * Note, only App Store is supported at this time.
 */
export async function downloadMetadataAsync(metadataContext: MetadataContext): Promise<string> {
  const filePath = path.resolve(metadataContext.projectDir, metadataContext.metadataFile);
  const fileExists = await fs.pathExists(filePath);

  if (fileExists && metadataContext.nonInteractive) {
    throw new MetadataValidationError(`Store configuration already exists at "${filePath}"`);
  } else if (fileExists) {
    const overwrite = await confirmAsync({
      message: `Do you want to overwrite the existing store configuration "${metadataContext.metadataFile}"?`,
    });
    if (!overwrite) {
      throw new MetadataValidationError(`Store configuration already exists at "${filePath}"`);
    }
  }

  const { app, auth } = await ensureMetadataAppStoreAuthenticatedAsync(metadataContext);
  const { unsubscribeTelemetry, executionId } = subscribeTelemetry(
    MetadataEvent.APPLE_METADATA_DOWNLOAD,
    { app, auth }
  );

  const errors: Error[] = [];
  const config = createAppleWriter();
  const tasks = createAppleTasks(metadataContext);
  const taskCtx = { app };

  for (const task of tasks) {
    try {
      await task.prepareAsync({ context: taskCtx });
    } catch (error: any) {
      errors.push(error);
    }
  }

  for (const task of tasks) {
    try {
      await task.downloadAsync({ config, context: taskCtx as AppleData });
    } catch (error: any) {
      errors.push(error);
    }
  }

  await fs.writeJson(filePath, config.toSchema(), { spaces: 2 });
  unsubscribeTelemetry();

  if (errors.length > 0) {
    throw new MetadataDownloadError(errors, executionId);
  }

  return filePath;
}
