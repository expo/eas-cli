import fs from 'fs-extra';
import path from 'path';

import { MetadataEvent } from '../analytics/events.js';
import Log from '../log.js';
import { confirmAsync } from '../prompts.js';
import { AppleData } from './apple/data.js';
import { createAppleTasks } from './apple/tasks/index.js';
import { createAppleWriter } from './config.js';
import { MetadataContext, ensureMetadataAppStoreAuthenticatedAsync } from './context.js';
import { MetadataDownloadError, MetadataValidationError } from './errors.js';
import { subscribeTelemetry } from './utils/telemetry.js';

/**
 * Generate a local store configuration from the stores.
 * Note, only App Store is supported at this time.
 */
export async function downloadMetadataAsync(metadataCtx: MetadataContext): Promise<string> {
  const filePath = path.resolve(metadataCtx.projectDir, metadataCtx.metadataPath);
  const fileExists = await fs.pathExists(filePath);

  if (fileExists) {
    const overwrite = await confirmAsync({
      message: `Do you want to overwrite the existing store configuration "${metadataCtx.metadataPath}"?`,
    });
    if (!overwrite) {
      throw new MetadataValidationError(`Store configuration already exists at "${filePath}"`);
    }
  }

  const { app, auth } = await ensureMetadataAppStoreAuthenticatedAsync(metadataCtx);
  const { unsubscribeTelemetry, executionId } = subscribeTelemetry(
    MetadataEvent.APPLE_METADATA_DOWNLOAD,
    { app, auth }
  );

  Log.addNewLineIfNone();
  Log.log('Downloading App Store configuration...');

  const errors: Error[] = [];
  const config = createAppleWriter();
  const tasks = createAppleTasks(metadataCtx);
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

  try {
    await fs.writeJson(filePath, config.toSchema(), { spaces: 2 });
  } finally {
    unsubscribeTelemetry();
  }

  if (errors.length > 0) {
    throw new MetadataDownloadError(errors, executionId);
  }

  return filePath;
}
