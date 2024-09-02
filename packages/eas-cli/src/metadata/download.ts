import { ExpoConfig } from '@expo/config';
import { SubmitProfile } from '@expo/eas-json';
import fs from 'fs-extra';
import path from 'path';

import { AppleData } from './apple/data';
import { createAppleTasks } from './apple/tasks';
import { getAppStoreAuthAsync } from './auth';
import { createAppleWriter, getStaticConfigFilePath } from './config/resolve';
import { MetadataDownloadError, MetadataValidationError } from './errors';
import { subscribeTelemetry } from './utils/telemetry';
import { Analytics, MetadataEvent } from '../analytics/AnalyticsManager';
import { CredentialsContext } from '../credentials/context';
import Log from '../log';
import { confirmAsync } from '../prompts';

/**
 * Generate a local store configuration from the stores.
 * Note, only App Store is supported at this time.
 */
export async function downloadMetadataAsync({
  projectDir,
  profile,
  exp,
  analytics,
  credentialsCtx,
}: {
  projectDir: string;
  profile: SubmitProfile;
  exp: ExpoConfig;
  analytics: Analytics;
  credentialsCtx: CredentialsContext;
}): Promise<string> {
  const filePath = getStaticConfigFilePath({ projectDir, profile });

  const fileExists = await fs.pathExists(filePath);
  if (fileExists) {
    const filePathRelative = path.relative(projectDir, filePath);
    const overwrite = await confirmAsync({
      message: `Do you want to overwrite the existing "${filePathRelative}"?`,
    });
    if (!overwrite) {
      throw new MetadataValidationError(`Store config already exists at "${filePath}"`);
    }
  }

  const { app, auth } = await getAppStoreAuthAsync({
    exp,
    credentialsCtx,
    projectDir,
    profile,
  });

  const { unsubscribeTelemetry, executionId } = subscribeTelemetry(
    analytics,
    MetadataEvent.APPLE_METADATA_DOWNLOAD,
    { app, auth }
  );

  Log.addNewLineIfNone();
  Log.log('Downloading App Store config...');

  const errors: Error[] = [];
  const config = createAppleWriter();
  const tasks = createAppleTasks();
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
