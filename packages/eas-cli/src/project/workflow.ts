import { AndroidConfig, IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import vcs from '../vcs';

export async function resolveWorkflowAsync(
  projectDir: string,
  platform: Platform
): Promise<Workflow> {
  let platformWorkflowMarker;
  try {
    platformWorkflowMarker =
      platform === Platform.ANDROID
        ? await AndroidConfig.Paths.getAndroidManifestAsync(projectDir)
        : IOSConfig.Paths.getXcodeProjectPath(projectDir);
  } catch {
    return Workflow.MANAGED;
  }

  if (await fs.pathExists(platformWorkflowMarker)) {
    return (await vcs.isFileIgnoredAsync(path.relative(projectDir, platformWorkflowMarker)))
      ? Workflow.MANAGED
      : Workflow.GENERIC;
  } else {
    return Workflow.MANAGED;
  }
}
