import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';

import log from '../../log';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';
import { getBundleIdentifier } from './bundleIdentifer';

export async function configureIosAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasIosNativeProject) {
    return;
  }
  const bundleIdentifier = await getBundleIdentifier(ctx.projectDir, ctx.exp);
  IOSConfig.BundleIdenitifer.setBundleIdentifierForPbxproj(ctx.projectDir, bundleIdentifier, false);

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  log.withTick('Configured the Xcode project.');
}

export async function validateAndSyncProjectConfigurationAsync(
  projectDir: string,
  exp: ExpoConfig
): Promise<void> {
  // TODO: check bundle identifier
  if (isExpoUpdatesInstalled(projectDir)) {
    await syncUpdatesConfigurationAsync(projectDir, exp);
  }
}
