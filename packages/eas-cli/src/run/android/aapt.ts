import spawnAsync, { SpawnResult } from '@expo/spawn-async';
import glob from 'fast-glob';

import Log from '../../log';
import { sdkRoot } from './sdk';

async function aaptAsync(...options: string[]): Promise<SpawnResult> {
  return await spawnAsync(await getAaptExecutableAsync(), options);
}

export async function getAaptExecutableAsync(): Promise<string> {
  if (sdkRoot) {
    const aaptPaths = await glob(`${sdkRoot}/build-tools/**/aapt`, {});

    if (aaptPaths.length === 0) {
      throw new Error('Failed to resolve the Android aapt path');
    }

    return aaptPaths.sort().reverse()[0];
  }

  Log.debug('Failed to resolve the Android SDK path, falling back to global aapt executable');
  return 'aapt';
}

export async function getAptParametersAsync(
  appPath: string
): Promise<{ packageName: string; activityName: string }> {
  const { stdout } = await aaptAsync('dump', 'badging', appPath);

  const packageNameMatch = stdout.match(/package: name='([^']+)'/);
  if (!packageNameMatch) {
    throw new Error(`Could not read package name from ${appPath}`);
  }

  // get activity name
  const activityNameMatch = stdout.match(/launchable-activity: name='([^']+)'/);
  if (!activityNameMatch) {
    throw new Error(`Could not read activity name from ${appPath}`);
  }

  return {
    packageName: packageNameMatch[1],
    activityName: activityNameMatch[1],
  };
}
