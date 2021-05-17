import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';

import Log from '../../log';
import {
  getOrConfigureApplicationIdAsync,
  warnIfAndroidPackageDefinedInAppConfigForGenericProject,
} from '../../project/android/applicationId';
import { gitAddAsync } from '../../utils/git';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';

export async function configureAndroidAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasAndroidNativeProject) {
    await getOrConfigureApplicationIdAsync(ctx.projectDir, ctx.exp);
    return;
  }

  warnIfAndroidPackageDefinedInAppConfigForGenericProject(ctx.projectDir, ctx.exp);

  await AndroidConfig.EasBuild.configureEasBuildAsync(ctx.projectDir);

  const easGradlePath = AndroidConfig.EasBuild.getEasBuildGradlePath(ctx.projectDir);
  await gitAddAsync(easGradlePath, { intentToAdd: true });

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  Log.withTick('Android project configured');
}

export async function validateAndSyncProjectConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  if (!(await AndroidConfig.EasBuild.isEasBuildGradleConfiguredAsync(projectDir))) {
    throw new Error(
      'Project is not configured. Please run "eas build:configure" to configure the project.'
    );
  }
  if (isExpoUpdatesInstalled(projectDir)) {
    await syncUpdatesConfigurationAsync(projectDir, exp);
  }
}
