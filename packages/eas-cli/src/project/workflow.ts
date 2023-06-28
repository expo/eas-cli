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

  const vcsClient = getVcsClient();
  const vcsRootPath = path.normalize(await vcsClient.getRootPathAsync());
  for (const marker of platformWorkflowMarkers) {
    if (
      (await fs.pathExists(marker)) &&
      !(await vcsClient.isFileIgnoredAsync(path.relative(vcsRootPath, marker)))
    ) {
      return Workflow.GENERIC;
    }
  }
  return Workflow.MANAGED;
}

export async function resolveWorkflowPerPlatformAsync(
  projectDir: string
): Promise<Record<Platform, Workflow>> {
  const [android, ios] = await Promise.all([
    resolveWorkflowAsync(projectDir, Platform.ANDROID),
    resolveWorkflowAsync(projectDir, Platform.IOS),
  ]);
  return { android, ios };
}

export async function hasIgnoredIosProjectAsync(projectDir: string): Promise<boolean> {
  const vcsClient = getVcsClient();
  const vcsRootPath = path.normalize(await vcsClient.getRootPathAsync());

  try {
    const pbxProjectPath = IOSConfig.Paths.getPBXProjectPath(projectDir);
    return await vcsClient.isFileIgnoredAsync(path.relative(vcsRootPath, pbxProjectPath));
  } finally {
    return false;
  }
}
