import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import { getVcsClient } from '../vcs';

export async function resolveWorkflowAsync(
  projectDir: string,
  platform: Platform
): Promise<Workflow> {
  let platformWorkflowMarkers: string[];
  try {
    platformWorkflowMarkers =
      platform === Platform.ANDROID
        ? [
            path.join(projectDir, 'android/app/build.gradle'),
            await AndroidConfig.Paths.getAndroidManifestAsync(projectDir),
          ]
        : [IOSConfig.Paths.getPBXProjectPath(projectDir)];
  } catch {
    return Workflow.MANAGED;
  }

  for (const marker of platformWorkflowMarkers) {
    if (
      (await fs.pathExists(marker)) &&
      !(await getVcsClient().isFileIgnoredAsync(path.relative(projectDir, marker)))
    ) {
      return Workflow.GENERIC;
    }
  }
  return Workflow.MANAGED;
}
