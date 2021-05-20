import { Metadata } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';

import { getApplicationId } from '../project/android/applicationId';
import { getBundleIdentifier } from '../project/ios/bundleIdentifier';
import { getUsername } from '../project/projectUtils';
import { ensureLoggedInAsync } from '../user/actions';
import { gitCommitHashAsync } from '../utils/git';
import { readReleaseChannelSafelyAsync as readAndroidReleaseChannelSafelyAsync } from './android/UpdatesModule';
import { readVersionCode, readVersionName } from './android/version';
import { BuildContext } from './context';
import { readReleaseChannelSafelyAsync as readIosReleaseChannelSafelyAsync } from './ios/UpdatesModule';
import { readBuildNumberAsync, readShortVersionAsync } from './ios/version';
import { Platform } from './types';
import { isExpoUpdatesInstalled } from './utils/updates';

/**
 * We use require() to exclude package.json from TypeScript's analysis since it lives outside
 * the src directory and would change the directory structure of the emitted files
 * under the build directory
 */
const packageJSON = require('../../package.json');

export async function collectMetadata<T extends Platform>(
  ctx: BuildContext<T>,
  {
    credentialsSource,
  }: {
    credentialsSource?: CredentialsSource.LOCAL | CredentialsSource.REMOTE;
  }
): Promise<Metadata> {
  return {
    trackingContext: ctx.trackingCtx,
    appVersion: await resolveAppVersionAsync(ctx),
    appBuildVersion: await resolveAppBuildVersionAsync(ctx),
    cliVersion: packageJSON.version,
    workflow: ctx.buildProfile.workflow,
    credentialsSource,
    sdkVersion: ctx.commandCtx.exp.sdkVersion,
    releaseChannel: await resolveReleaseChannel(ctx),
    distribution: ctx.buildProfile.distribution ?? 'store',
    appName: ctx.commandCtx.exp.name,
    appIdentifier: resolveAppIdentifier(ctx),
    buildProfile: ctx.commandCtx.profile,
    gitCommitHash: await gitCommitHashAsync(),
    username: getUsername(ctx.commandCtx.exp, await ensureLoggedInAsync()),
  };
}

async function resolveAppVersionAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string | undefined> {
  if (ctx.platform === Platform.IOS) {
    return await readShortVersionAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  } else {
    return readVersionName(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  }
}

async function resolveAppBuildVersionAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string | undefined> {
  if (ctx.platform === Platform.IOS) {
    return await readBuildNumberAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  } else {
    const versionCode = readVersionCode(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
    return versionCode !== undefined ? String(versionCode) : undefined;
  }
}

function resolveAppIdentifier<T extends Platform>(ctx: BuildContext<T>): string {
  if (ctx.platform === Platform.IOS) {
    return getBundleIdentifier(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  } else {
    return getApplicationId(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  }
}

async function resolveReleaseChannel<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string | undefined> {
  if (!isExpoUpdatesInstalled(ctx.commandCtx.projectDir)) {
    return undefined;
  }

  if (ctx.buildProfile.releaseChannel) {
    return ctx.buildProfile.releaseChannel;
  }

  let maybeReleaseChannel: string | null;
  if (ctx.platform === Platform.ANDROID) {
    maybeReleaseChannel = await readAndroidReleaseChannelSafelyAsync(ctx.commandCtx.projectDir);
  } else {
    maybeReleaseChannel = await readIosReleaseChannelSafelyAsync(ctx.commandCtx.projectDir);
  }
  return maybeReleaseChannel ?? 'default';
}
