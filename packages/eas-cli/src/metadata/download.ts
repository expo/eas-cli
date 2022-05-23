import { App } from '@expo/apple-utils';
import fs from 'fs-extra';
import path from 'path';

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
  const absoluteMetaFile = path.resolve(projectDir, metaFile);
  // if (await fs.pathExists(absoluteMetaFile)) {
  //   throw new Error(`❌ File already exists at "${metaFile}"`);
  // }

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

  // Start download task sequence
  try {
    for (const task of tasks) {
      await task.downloadAsync({ config, context: ctx as AppleContext });
    }
  } catch (error) {
    handleTaskError(error);
  }

  // Write the config file
  await fs.writeJson(absoluteMetaFile, config.toSchema(), { spaces: 2 });
}

function handleTaskError(error: any): void {
  if (error.code === 'ERR_ASSERTION') {
    Log.error('- AssertError:', error.message);
  } else {
    Log.error(error);
  }
}
