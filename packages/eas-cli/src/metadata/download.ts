import { App } from '@expo/apple-utils';
import chalk from 'chalk';
import fs from 'fs-extra';

import Log from '../log';
import { AppleContext } from './apple/context';
import { createAppleTasks } from './apple/tasks';
import { createAppleWriter } from './config';

/**
 * Pull all data from the ASC API and store it locally in a config schema.
 */
export async function downloadAppleMetadataAsync(
  projectDir: string,
  metaFile: string,
  app: App
): Promise<void> {
  if (await fs.pathExists(metaFile)) {
    throw new Error(`❌ File already exists at "${metaFile}"`);
  }

  // Create an apple config writer
  const config = createAppleWriter();

  // Initialize the task sequence
  const tasks = createAppleTasks({ projectDir });
  const ctx = { app };

  // Start preparation task sequence
  try {
    for (const task of tasks) {
      await task.prepareAsync({ context: ctx });
    }
  } catch (error) {
    handleTaskError(error);
  }

  // Start upload task sequence
  try {
    for (const task of tasks) {
      Log.log(chalk`{bold Syncing ${task.name()}}`);
      await task.downloadAsync({ config, context: ctx as AppleContext });
      Log.log();
    }
  } catch (error) {
    handleTaskError(error);
  }

  // Write the config file
  await fs.writeJson(metaFile, config.toSchema());
}

function handleTaskError(error: any): void {
  if (error.code === 'ERR_ASSERTION') {
    Log.error('- AssertError:', error.message);
  } else {
    Log.error(error);
  }
}
