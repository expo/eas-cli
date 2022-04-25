import { App } from '@expo/apple-utils';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import Log from '../log';
import { AppleContext } from './apple/context';
import { createAppleTasks } from './apple/tasks';
import { createAppleReader, validateConfig } from './config';

/**
 * Start syncing the local metadata configuration to the App store.
 */
export async function uploadAppleMetadataAsync(
  projectDir: string,
  meta: string,
  app: App
): Promise<void> {
  const metaFile = path.resolve(projectDir, meta);
  if (!(await fs.pathExists(metaFile))) {
    return Log.error(`❌ Meta config file not found "${meta}"`);
  }

  const metaData = await fs.readJson(metaFile);
  const { valid, errors } = validateConfig(meta);
  if (!valid) {
    Log.error('❌ Meta config errors found');
    for (const error of errors) {
      Log.log(`  - ${error.dataPath} ${error.message}`);
    }
    return;
  }

  // Create a versioned apple config reader
  const config = createAppleReader(metaData);

  // Initialize the task sequence
  const tasks = createAppleTasks({ projectDir });
  const ctx = { app };

  // Start preparation task sequence
  try {
    for (const task of tasks) {
      await task.preuploadAsync({ config, context: ctx });
    }
  } catch (error) {
    handleTaskError(error);
  }

  // Start upload task sequence
  try {
    for (const task of tasks) {
      Log.log(chalk`{bold Syncing ${task.name()}}`);
      await task.preuploadAsync({ config, context: ctx as AppleContext });
      Log.log();
    }
  } catch (error) {
    handleTaskError(error);
  }
}

function handleTaskError(error: any): void {
  if (error.code === 'ERR_ASSERTION') {
    Log.error('- AssertError:', error.message);
  } else {
    Log.error(error);
  }
}
