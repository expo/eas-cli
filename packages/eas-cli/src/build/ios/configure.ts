import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';

import log from '../../log';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';
import { configureBundleIdentifierAsync } from './bundleIdentifer';

export async function configureIosAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasIosNativeProject) {
    return;
  }
  await configureBundleIdentifierAsync(ctx.projectDir, ctx.exp);

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  log.withTick('Configured the Xcode project.');
}

export async function validateAndSyncProjectConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  const bundleIdentifierFromPbxproj = IOSConfig.BundleIdenitifer.getBundleIdentifierFromPbxproj(
    projectDir
  );
  if (!bundleIdentifierFromPbxproj || bundleIdentifierFromPbxproj !== exp.ios?.bundleIdentifier) {
    throw new Error(
      'Bundle identifier is not configured correctly in your Xcode project. Please run "eas build:configure" first to configure it.'
    );
  }
  if (isExpoUpdatesInstalled(projectDir)) {
    await syncUpdatesConfigurationAsync(projectDir, exp);
  }
}
