import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';

import log from '../../log';
import { getAndroidApplicationIdAsync } from '../../project/projectUtils';
import { gitAddAsync } from '../../utils/git';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';
import { configureApplicationIdAsync, ensureApplicationIdIsValidAsync } from './applicationId';

export async function configureAndroidAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasAndroidNativeProject) {
    return;
  }
  await AndroidConfig.EasBuild.configureEasBuildAsync(ctx.projectDir);
  await configureApplicationIdAsync(ctx.projectDir, ctx.exp, ctx.allowExperimental);
  await ensureApplicationIdIsValidAsync(ctx.projectDir);

  const easGradlePath = AndroidConfig.EasBuild.getEasBuildGradlePath(ctx.projectDir);
  await gitAddAsync(easGradlePath, { intentToAdd: true });

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  log.withTick('Android project configured');
}

export async function validateAndSyncProjectConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  const applicationIdFromAndroidProject = await getAndroidApplicationIdAsync(projectDir);
  const packageNameFromConfig = AndroidConfig.Package.getPackage(exp);
  const isApplicationIdConfigured =
    applicationIdFromAndroidProject && applicationIdFromAndroidProject === packageNameFromConfig;

  const isEasBuildGradleConfigured = await AndroidConfig.EasBuild.isEasBuildGradleConfiguredAsync(
    projectDir
  );
  if (!isEasBuildGradleConfigured || !isApplicationIdConfigured) {
    throw new Error(
      'Project is not configured. Please run "eas build:configure" to configure the project.'
    );
  }

  if (isExpoUpdatesInstalled(projectDir)) {
    await syncUpdatesConfigurationAsync(projectDir, exp);
  }
}
