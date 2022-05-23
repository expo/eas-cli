import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import Log from '../log';
import { AppleContext } from './apple/context';
import { createAppleTasks } from './apple/tasks';
import { createAppleReader, validateConfig } from './config';
import { MetadataUploadError, MetadataValidationError } from './errors';
import { TelemetryContext, subscribeTelemetry } from './utils/telemetry';

type UploadAppleMetadataOptions = TelemetryContext & {
  /** The root location of the project, used to load the metadata */
  projectDir: string;
  /** The relative metadata file path */
  metadataFile: string;
};

/**
 * Start syncing the local metadata configuration to the App store.
 */
export async function uploadAppleMetadataAsync({
  projectDir,
  metadataFile,
  app,
  auth,
}: UploadAppleMetadataOptions): Promise<void> {
  const { unsubscribeTelemetry, executionId } = subscribeTelemetry({ app, auth });

  const metaFile = path.resolve(projectDir, metadataFile);
  if (!(await fs.pathExists(metaFile))) {
    throw new MetadataValidationError(`Metadata config file not found "${metaFile}"`);
  }

  const metaData = await fs.readJson(metaFile);
  const { valid, errors: validationErrors } = validateConfig(metaData);
  if (!valid) {
    throw new MetadataValidationError(`Metadata config errors found`, validationErrors);
  }

  // Keep track of encountered errors to log them at the end.
  const errors: Error[] = [];

  // Create a versioned apple config reader
  const config = createAppleReader(metaData);

  // Initialize the task sequence
  const tasks = createAppleTasks({ projectDir });
  const ctx = { app };

  // Start preparation task sequence
  try {
    for (const task of tasks) {
      await task.prepareAsync({ context: ctx });
    }
  } catch (error: any) {
    logTaskError(error);
    errors.push(error);
  }

  // Start upload task sequence
  try {
    for (const task of tasks) {
      Log.log(chalk`{bold Syncing ${task.name()}}`);
      await task.uploadAsync({ config, context: ctx as AppleContext });
      Log.log();
    }
  } catch (error: any) {
    logTaskError(error);
    errors.push(error);
  }

  unsubscribeTelemetry();

  if (errors.length > 0) {
    throw new MetadataUploadError(errors, executionId);
  }
}

function logTaskError(error: any): void {
  if (error.code === 'ERR_ASSERTION') {
    Log.error('- AssertError:', error.message);
  } else {
    Log.error(error);
  }
}
