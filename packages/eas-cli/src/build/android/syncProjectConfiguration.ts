import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';
import { Env, Platform, Workflow } from '@expo/eas-build-job';
import { AndroidVersionAutoIncrement } from '@expo/eas-json';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import { BumpStrategy, bumpVersionAsync, bumpVersionInAppJsonAsync } from './version';
import Log from '../../log';
import { isExpoUpdatesInstalled } from '../../project/projectUtils';
import { resolveWorkflowAsync } from '../../project/workflow';
import { syncUpdatesConfigurationAsync } from '../../update/android/UpdatesModule';
import { Client } from '../../vcs/vcs';

export async function syncProjectConfigurationAsync({
  projectDir,
  exp,
  localAutoIncrement,
  vcsClient,
  env,
}: {
  projectDir: string;
  exp: ExpoConfig;
  localAutoIncrement?: AndroidVersionAutoIncrement;
  vcsClient: Client;
  env: Env | undefined;
}): Promise<void> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);
  const versionBumpStrategy = resolveVersionBumpStrategy(localAutoIncrement ?? false);

  if (workflow === Workflow.GENERIC) {
    await cleanUpOldEasBuildGradleScriptAsync(projectDir);
    if (isExpoUpdatesInstalled(projectDir)) {
      await syncUpdatesConfigurationAsync({ projectDir, exp, workflow, env });
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
export async function cleanUpOldEasBuildGradleScriptAsync(projectDir: string): Promise<void> {
  const easBuildGradlePath = path.join(projectDir, 'android', 'app', 'eas-build.gradle');
  if (await fs.pathExists(easBuildGradlePath)) {
    Log.withTick(`Removing ${chalk.bold('eas-build.gradle')} as it's not longer necessary`);
    await fs.remove(easBuildGradlePath);

    const buildGradlePath = AndroidConfig.Paths.getAppBuildGradleFilePath(projectDir);
    const buildGradleContents = await fs.readFile(buildGradlePath, 'utf-8');
    const buildGradleContentsWithoutApply = buildGradleContents.replace(
      /apply from: ["'].\/eas-build.gradle["']\n/,
      ''
    );
    if (buildGradleContentsWithoutApply !== buildGradleContents) {
      await fs.writeFile(buildGradlePath, buildGradleContentsWithoutApply);
    }
  }
}
