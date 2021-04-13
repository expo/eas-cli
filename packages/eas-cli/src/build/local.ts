import { Job } from '@expo/eas-build-job';
import spawnAsync from '@expo/spawn-async';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import Log from '../log';

const PLUGIN_PACKAGE_NAME = 'eas-cli-local-build-plugin';

export async function runLocalBuildAsync(job: Job): Promise<void> {
  const execNameOrPath =
    process.env.EAS_LOCAL_BUILD_PLUGIN_PATH ??
    (await findWithNodeResolution()) ??
    PLUGIN_PACKAGE_NAME;
  try {
    const arg = Buffer.from(JSON.stringify({ job })).toString('base64');
    await spawnAsync(execNameOrPath, [arg], {
      stdio: 'inherit',
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      Log.warn(`Could not resolve executable ${execNameOrPath}.`);
      Log.warn(
        `Install ${PLUGIN_PACKAGE_NAME} package from npm e.g. ${chalk.bold(
          `npm install -g ${PLUGIN_PACKAGE_NAME}`
        )} and make sure it's in PATH.`
      );
      throw err;
    }
  }
}

async function findWithNodeResolution(): Promise<string | undefined> {
  try {
    const resolvedPath = path.resolve(
      path.dirname(require.resolve(PLUGIN_PACKAGE_NAME)),
      '../bin/run'
    );
    if (await fs.pathExists(resolvedPath)) {
      return resolvedPath;
    }
  } catch {}
  return undefined;
}
