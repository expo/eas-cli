import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import { Platform, Workflow } from '@expo/eas-build-job';
import { AndroidVersionAutoIncrement, BuildProfile } from '@expo/eas-json';
import fs from 'fs-extra';
import path from 'path';

import { resolveWorkflowAsync } from '../../project/workflow';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { syncUpdatesConfigurationAsync } from './UpdatesModule';
import { BumpStrategy, bumpVersionAsync, bumpVersionInAppJsonAsync } from './version';

export async function syncProjectConfigurationAsync({
  projectDir,
  exp,
  buildProfile,
}: {
  projectDir: string;
  exp: ExpoConfig;
  buildProfile: BuildProfile<Platform.ANDROID>;
}): Promise<void> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID);
  const { autoIncrement } = buildProfile;
  const versionBumpStrategy = resolveVersionBumpStrategy(autoIncrement ?? false);

  if (workflow === Workflow.GENERIC) {
    await cleanUpOldEasBuildGradleScriptAsync(projectDir);
    if (isExpoUpdatesInstalled(projectDir)) {
      await syncUpdatesConfigurationAsync(projectDir, exp);
    }
    await bumpVersionAsync({ projectDir, exp, bumpStrategy: versionBumpStrategy });
  } else {
    await bumpVersionInAppJsonAsync({ projectDir, exp, bumpStrategy: versionBumpStrategy });
  }
}

function resolveVersionBumpStrategy(autoIncrement: AndroidVersionAutoIncrement): BumpStrategy {
  if (autoIncrement === true) {
    return BumpStrategy.VERSION_CODE;
  } else if (autoIncrement === false) {
    return BumpStrategy.NOOP;
  } else if (autoIncrement === 'versionCode') {
    return BumpStrategy.VERSION_CODE;
  } else {
    return BumpStrategy.APP_VERSION;
  }
}

// TODO: remove this after a few months
async function cleanUpOldEasBuildGradleScriptAsync(projectDir: string): Promise<void> {
  const easBuildGradlePath = path.join(projectDir, 'android', 'app', 'eas-build.gradle');
  if (await fs.pathExists(easBuildGradlePath)) {
    await fs.remove(easBuildGradlePath);

    const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
    const buildGradleContents = await fs.readFile(buildGradlePath, 'utf-8');
    const APPLY_EAS_BUILD_GRADLE_LINE = 'apply from: "./eas-build.gradle"';
    const buildGradleContentsWithoutApply = buildGradleContents.replace(
      `${APPLY_EAS_BUILD_GRADLE_LINE}\n`,
      ''
    );
    if (buildGradleContentsWithoutApply !== buildGradleContents) {
      await fs.writeFile(buildGradlePath, buildGradleContentsWithoutApply);
    }
  }
}
