import { ExpoConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { IosBuildProfile, VersionAutoIncrement } from '@expo/eas-json';

import Log from '../../log';
import {
  ensureBundleIdentifierIsDefinedForManagedProjectAsync,
  warnIfBundleIdentifierDefinedInAppConfigForGenericProject,
} from '../../project/ios/bundleIdentifier';
import { resolveWorkflowAsync } from '../../project/workflow';
import { ConfigureContext } from '../context';
import { isExpoUpdatesInstalled } from '../utils/updates';
import { configureUpdatesAsync, syncUpdatesConfigurationAsync } from './UpdatesModule';
import { BumpStrategy, bumpVersionAsync, bumpVersionInAppJsonAsync } from './version';

export async function configureIosAsync(ctx: ConfigureContext): Promise<void> {
  if (!ctx.hasIosNativeProject) {
    await ensureBundleIdentifierIsDefinedForManagedProjectAsync(ctx.projectDir, ctx.exp);
    return;
  }

  warnIfBundleIdentifierDefinedInAppConfigForGenericProject(ctx.projectDir, ctx.exp);

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
  buildProfile: IosBuildProfile;
}): Promise<void> {
  const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS);
  const { autoIncrement } = buildProfile;
  const versionBumpStrategy = resolveVersionBumpStrategy(autoIncrement ?? false);

  if (workflow === Workflow.GENERIC) {
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
