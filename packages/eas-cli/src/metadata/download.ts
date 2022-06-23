import fs from 'fs-extra';
import path from 'path';

import { MetadataEvent } from '../analytics/events';
import Log from '../log';
import { confirmAsync } from '../prompts';
import { AppleData, PartialAppleData } from './apple/data';
import { createAppleTasks } from './apple/tasks';
import { createAppleWriter } from './config';
import { MetadataContext, ensureMetadataAppStoreAuthenticatedAsync } from './context';
import { MetadataDownloadError, MetadataValidationError } from './errors';
import { withTelemetryAsync } from './utils/telemetry';

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

  Log.addNewLineIfNone();
  Log.log('Downloading App Store configuration...');

  await withTelemetryAsync(MetadataEvent.APPLE_METADATA_DOWNLOAD, { app, auth }, async () => {
    const errors: Error[] = [];
    const config = createAppleWriter();
    const tasks = createAppleTasks(metadataCtx);
    const taskCtx: PartialAppleData = { app };

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

    if (errors.length > 0) {
      throw new MetadataDownloadError(errors);
    }
  });

  return filePath;
}
