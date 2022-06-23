import fs from 'fs-extra';
import path from 'path';

import { MetadataEvent } from '../analytics/events';
import Log from '../log';
import { confirmAsync } from '../prompts';
import { AppleData } from './apple/data';
import { createAppleTasks } from './apple/tasks';
import { createAppleReader, validateConfig } from './config';
import { MetadataContext, ensureMetadataAppStoreAuthenticatedAsync } from './context';
import { MetadataUploadError, MetadataValidationError, logMetadataValidationError } from './errors';
import { subscribeTelemetry } from './utils/telemetry';

/**
 * Sync a local store configuration with the stores.
 * Note, only App Store is supported at this time.
 */
export async function uploadMetadataAsync(
  metadataCtx: MetadataContext
): Promise<{ appleLink: string }> {
  const filePath = path.resolve(metadataCtx.projectDir, metadataCtx.metadataPath);
  if (!(await fs.pathExists(filePath))) {
    throw new MetadataValidationError(`Store configuration file not found "${filePath}"`);
  }

  const fileData = await fs.readJson(filePath);
  const { valid, errors: validationErrors } = validateConfig(fileData);
  if (!valid) {
    const error = new MetadataValidationError(`Store configuration errors found`, validationErrors);
    logMetadataValidationError(error);
    Log.newLine();
    Log.warn(
      'Without further updates, the current store configuration may fail to be synchronized with the App Store or pass App Store review.'
    );
    const attempt = await confirmAsync({
      message: 'Do you still want to attempt syncing the store configuration?',
    });
    if (!attempt) {
      throw error;
    }
  }

  const { app, auth } = await ensureMetadataAppStoreAuthenticatedAsync(metadataCtx);
  const { unsubscribeTelemetry, executionId } = subscribeTelemetry(
    MetadataEvent.APPLE_METADATA_UPLOAD,
    { app, auth }
  );

  Log.addNewLineIfNone();
  Log.log('Uploading App Store configuration...');

  const errors: Error[] = [];
  const config = createAppleReader(fileData);
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
      await task.uploadAsync({ config, context: taskCtx as AppleData });
    } catch (error: any) {
      errors.push(error);
    }
  }

  unsubscribeTelemetry();

  if (errors.length > 0) {
    throw new MetadataUploadError(errors, executionId);
  }

  return { appleLink: `https://appstoreconnect.apple.com/apps/${app.id}/appstore` };
}
