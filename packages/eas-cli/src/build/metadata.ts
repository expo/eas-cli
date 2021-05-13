import { Metadata } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';

import { getUsername } from '../project/projectUtils';
import { ensureLoggedInAsync } from '../user/actions';
import { gitCommitHashAsync } from '../utils/git';
import { readReleaseChannelSafelyAsync as readAndroidReleaseChannelSafelyAsync } from './android/UpdatesModule';
import { getApplicationId } from './android/applicationId';
import { BuildContext } from './context';
import { readReleaseChannelSafelyAsync as readIosReleaseChannelSafelyAsync } from './ios/UpdatesModule';
import { getBundleIdentifier } from './ios/bundleIdentifier';
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
  const appIdentifierOpts = {
    projectDir: ctx.commandCtx.projectDir,
    exp: ctx.commandCtx.exp,
    workflow: ctx.buildProfile.workflow,
  };
  const appIdentifier =
    ctx.platform === Platform.IOS
      ? getBundleIdentifier(appIdentifierOpts)
      : getApplicationId(appIdentifierOpts);
  return {
    trackingContext: ctx.trackingCtx,
    appVersion: ctx.commandCtx.exp.version!,
    cliVersion: packageJSON.version,
    workflow: ctx.buildProfile.workflow,
    credentialsSource,
    sdkVersion: ctx.commandCtx.exp.sdkVersion,
    releaseChannel: await resolveReleaseChannel(ctx),
    distribution: ctx.buildProfile.distribution ?? 'store',
    appName: ctx.commandCtx.exp.name,
    appIdentifier,
    buildProfile: ctx.commandCtx.profile,
    gitCommitHash: await gitCommitHashAsync(),
    username: getUsername(ctx.commandCtx.exp, await ensureLoggedInAsync()),
  };
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
