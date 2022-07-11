import { IOSConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import { getVcsClient } from '../vcs';

export async function resolveWorkflowAsync(
  projectDir: string,
  platform: Platform
): Promise<Workflow> {
  let platformWorkflowMarker;
  try {
    platformWorkflowMarker =
      platform === Platform.ANDROID
        ? path.join(projectDir, 'android/app/build.gradle')
        : IOSConfig.Paths.getPBXProjectPath(projectDir);
  } catch {
    return Workflow.MANAGED;
  }

  if (await fs.pathExists(platformWorkflowMarker)) {
    return (await getVcsClient().isFileIgnoredAsync(
      path.relative(projectDir, platformWorkflowMarker)
    ))
      ? Workflow.MANAGED
      : Workflow.GENERIC;
  } else {
    return Workflow.MANAGED;
  }
}
