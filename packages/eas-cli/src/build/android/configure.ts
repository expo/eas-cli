import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';

import Log from '../../log';
import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  warnIfAndroidPackageDefinedInAppConfigForGenericProject,
} from '../../project/android/applicationId';
import vcs from '../../vcs';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';

export async function configureAndroidAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasAndroidNativeProject) {
    await ensureApplicationIdIsDefinedForManagedProjectAsync(ctx.projectDir, ctx.exp);
    return;
  }

  warnIfAndroidPackageDefinedInAppConfigForGenericProject(ctx.projectDir, ctx.exp);

  await AndroidConfig.EasBuild.configureEasBuildAsync(ctx.projectDir);

  const easGradlePath = AndroidConfig.EasBuild.getEasBuildGradlePath(ctx.projectDir);
  await vcs.trackFileAsync(easGradlePath);

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
