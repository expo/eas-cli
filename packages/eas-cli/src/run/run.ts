import path from 'path';

import { runAppOnAndroidEmulatorAsync } from './android/run';
import { runAppOnIosSimulatorAsync } from './ios/run';
import { AppPlatform } from '../graphql/generated';
import { getEasBuildRunCacheDirectoryPath } from '../utils/paths';

export interface RunArchiveFlags {
  latest?: boolean;
  id?: string;
  path?: string;
  url?: string;
}

export interface RunOptions {
  simulatorId?: string;
}

export async function runAsync(
  simulatorBuildPath: string,
  selectedPlatform: AppPlatform,
  options: RunOptions = {}
): Promise<void> {
  if (selectedPlatform === AppPlatform.Ios) {
    await runAppOnIosSimulatorAsync(simulatorBuildPath, options.simulatorId);
  } else {
    await runAppOnAndroidEmulatorAsync(simulatorBuildPath);
  }
}

export function getEasBuildRunCachedAppPath(
  projectId: string,
  buildId: string,
  platform: AppPlatform
): string {
  return path.join(
    getEasBuildRunCacheDirectoryPath(),
    `${projectId}_${buildId}.${platform === AppPlatform.Ios ? 'app' : 'apk'}`
  );
}
