import { ExpoConfig } from '@expo/config';
import { AndroidConfig } from '@expo/config-plugins';

import log from '../../log';
import { gitAddAsync } from '../../utils/git';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';

export async function configureAndroidAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasAndroidNativeProject) {
    return;
  }
  await AndroidConfig.EasBuild.configureEasBuildAsync(ctx.projectDir);

  const easGradlePath = AndroidConfig.EasBuild.getEasBuildGradlePath(ctx.projectDir);
  await gitAddAsync(easGradlePath, { intentToAdd: true });

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  log.withTick('Configured the Android project');
}

export async function validateAndSyncProjectConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  const isProjectConfigured = await AndroidConfig.EasBuild.isEasBuildGradleConfiguredAsync(
    projectDir
  );
  if (!isProjectConfigured) {
    throw new Error(
      'Project is not configured. Please run "eas build:configure" first to configure the project'
    );
  }

  if (isExpoUpdatesInstalled(projectDir)) {
    await syncUpdatesConfigurationAsync(projectDir, exp);
  }
}
