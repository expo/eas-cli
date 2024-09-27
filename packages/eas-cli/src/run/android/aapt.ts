import spawnAsync, { SpawnResult } from '@expo/spawn-async';
import glob from 'fast-glob';
import path from 'path';

import { getAndroidSdkRootAsync } from './sdk';
import Log from '../../log';

async function aaptAsync(...options: string[]): Promise<SpawnResult> {
  try {
    return await spawnAsync(await getAaptExecutableAsync(), options);
  } catch (error: any) {
    if (error.stderr) {
      Log.error(error.stderr);
    }
    throw error;
  }
}

export async function getAaptExecutableAsync(): Promise<string> {
  const sdkRoot = await getAndroidSdkRootAsync();
  if (!sdkRoot) {
    Log.debug('Failed to resolve the Android SDK path, falling back to global aapt executable');
    return 'aapt';
  }
  const aaptPaths = await glob(
    path.posix.join('build-tools/**', process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
    { cwd: sdkRoot, absolute: true }
  );

  if (aaptPaths.length === 0) {
    throw new Error('Failed to resolve the Android aapt path');
  }
  const sorted = aaptPaths.sort();
  return sorted[sorted.length - 1];
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
