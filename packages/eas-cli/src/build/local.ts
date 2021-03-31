import { Job } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import Log from '../log';

export async function runLocalBuildAsync(job: Job): Promise<void> {
  const execNameOrPath =
    process.env.EAS_LOCAL_BUILD_PLUGIN_PATH ??
    (await findWithNodeResolution()) ??
    'eas-cli-local-build-plugin';
  try {
    const arg = Buffer.from(JSON.stringify({ job })).toString('base64');
    await spawnAsync(execNameOrPath, [arg], {
      stdio: 'inherit',
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      Log.warn(`Could not resolve executable ${execNameOrPath}.`);
      Log.warn(
        `Install eas-cli-local-build-plugin package from npm e.g. ${chalk.bold(
          'npm install -g eas-cli-local-build-plugin'
        )} and make sure it's in PATH.`
      );
      throw err;
    }
  }
}

async function findWithNodeResolution(): Promise<string | undefined> {
  try {
    const resolvedPath = path.resolve(
      path.dirname(require.resolve('eas-cli-local-build-plugin')),
      '../bin/run'
    );
    if (await fs.pathExists(resolvedPath)) {
      return resolvedPath;
    }
  } catch {}
  return undefined;
}
