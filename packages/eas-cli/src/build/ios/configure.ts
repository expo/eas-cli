import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { Workflow } from '@expo/eas-build-job';
import { VersionAutoIncrement, iOSBuildProfile } from '@expo/eas-json';

import Log from '../../log';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';
import {
  configureBundleIdentifierAsync,
  ensureBundleIdentifierIsValidAsync,
} from './bundleIdentifer';
import { BumpStrategy, bumpVersionAsync, bumpVersionInAppJsonAsync } from './version';

export async function configureIosAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasIosNativeProject) {
    return;
  }
  await configureBundleIdentifierAsync(ctx.projectDir, ctx.exp);
  await ensureBundleIdentifierIsValidAsync(ctx.projectDir);

  if (isExpoUpdatesInstalled(ctx.projectDir)) {
    await configureUpdatesAsync(ctx.projectDir, ctx.exp);
  }
  Log.withTick('iOS project configured');
}

export async function validateAndSyncProjectConfigurationAsync({
  projectDir,
  exp,
  buildProfile,
}: {
  projectDir: string;
  exp: ExpoConfig;
  buildProfile: iOSBuildProfile;
}): Promise<void> {
  const { workflow, autoIncrement } = buildProfile;
  const versionBumpStrategy = resolveVersionBumpStrategy(autoIncrement);

  if (workflow === Workflow.Generic) {
    const bundleIdentifierFromPbxproj = IOSConfig.BundleIdentifier.getBundleIdentifierFromPbxproj(
      projectDir
    );
    if (!bundleIdentifierFromPbxproj || bundleIdentifierFromPbxproj !== exp.ios?.bundleIdentifier) {
      throw new Error(
        'Bundle identifier is not configured correctly in your Xcode project. Please run "eas build:configure" to configure it.'
      );
    }
    if (isExpoUpdatesInstalled(projectDir)) {
      await syncUpdatesConfigurationAsync(projectDir, exp);
    }
    await bumpVersionAsync({ projectDir, exp, bumpStrategy: versionBumpStrategy });
  } else {
    await bumpVersionInAppJsonAsync({ projectDir, exp, bumpStrategy: versionBumpStrategy });
  }
}

function resolveVersionBumpStrategy(autoIncrement: VersionAutoIncrement): BumpStrategy {
  if (autoIncrement === true) {
    return BumpStrategy.BUILD_NUMBER;
  } else if (autoIncrement === false) {
    return BumpStrategy.NOOP;
  } else if (autoIncrement === 'buildNumber') {
    return BumpStrategy.BUILD_NUMBER;
  } else {
    return BumpStrategy.SHORT_VERSION;
  }
}
