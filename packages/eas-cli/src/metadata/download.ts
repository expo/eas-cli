import fs from 'fs-extra';
import path from 'path';

import { MetadataEvent } from '../analytics/AnalyticsManager';
import Log from '../log';
import { confirmAsync } from '../prompts';
import { AppleData } from './apple/data';
import { createAppleTasks } from './apple/tasks';
import { createAppleWriter, getStaticConfigFilePath } from './config/resolve';
import { MetadataContext, ensureMetadataAppStoreAuthenticatedAsync } from './context';
import { MetadataDownloadError, MetadataValidationError } from './errors';
import { subscribeTelemetry } from './utils/telemetry';

/**
 * Generate a local store configuration from the stores.
 * Note, only App Store is supported at this time.
 */
export async function downloadMetadataAsync(metadataCtx: MetadataContext): Promise<string> {
  const filePath = getStaticConfigFilePath(metadataCtx);
  const fileExists = await fs.pathExists(filePath);

  if (fileExists) {
    const filePathRelative = path.relative(metadataCtx.projectDir, filePath);
    const overwrite = await confirmAsync({
      message: `Do you want to overwrite the existing "${filePathRelative}"?`,
    });
    if (!overwrite) {
      throw new MetadataValidationError(`Store config already exists at "${filePath}"`);
    }
  }

  const { app, auth } = await ensureMetadataAppStoreAuthenticatedAsync(metadataCtx);
  const { unsubscribeTelemetry, executionId } = subscribeTelemetry(
    metadataCtx.analytics,
    MetadataEvent.APPLE_METADATA_DOWNLOAD,
    { app, auth }
  );

  Log.addNewLineIfNone();
  Log.log('Downloading App Store config...');

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
    await fs.writeJSON(filePath, config.toSchema(), { spaces: 2 });
  } finally {
    unsubscribeTelemetry();
  }

  if (errors.length > 0) {
    throw new MetadataDownloadError(errors, executionId);
  }

  return filePath;
}
