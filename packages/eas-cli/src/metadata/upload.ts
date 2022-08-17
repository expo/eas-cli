import { MetadataEvent } from '../analytics/events';
import Log from '../log';
import { confirmAsync } from '../prompts';
import { AppleData } from './apple/data';
import { createAppleTasks } from './apple/tasks';
import { MetadataConfig, createAppleReader, loadConfigAsync } from './config';
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
  const storeConfig = await loadConfigWithValidationPromptAsync(metadataCtx);
  const { app, auth } = await ensureMetadataAppStoreAuthenticatedAsync(metadataCtx);
  const { unsubscribeTelemetry, executionId } = subscribeTelemetry(
    MetadataEvent.APPLE_METADATA_UPLOAD,
    { app, auth }
  );

  Log.addNewLineIfNone();
  Log.log('Uploading App Store configuration...');

  const errors: Error[] = [];
  const config = createAppleReader(storeConfig);
  const tasks = createAppleTasks(metadataCtx, {
    // We need to resolve a different version as soon as possible.
    // This version is the parent model of all changes we are going to push.
    version: config.getVersion()?.versionString,
  });

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

async function loadConfigWithValidationPromptAsync(
  metadataCtx: MetadataContext
): Promise<MetadataConfig> {
  try {
    return await loadConfigAsync(metadataCtx);
  } catch (error) {
    if (error instanceof MetadataValidationError) {
      logMetadataValidationError(error);
      Log.newLine();
      Log.warn(
        'Without further updates, the current store configuration can fail to be synchronized with the App Store or pass App Store review.'
      );

      if (await confirmAsync({ message: 'Do you still want to push the store configuration?' })) {
        return await loadConfigAsync({ ...metadataCtx, skipValidation: true });
      }
    }

    throw error;
  }
}
