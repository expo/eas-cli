import { Metadata } from '@expo/eas-build-job';
import { CredentialsSource, IosEnterpriseProvisioning } from '@expo/eas-json';

import { getApplicationIdAsync } from '../project/android/applicationId';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
import { getUsername } from '../project/projectUtils';
import { ensureLoggedInAsync } from '../user/actions';
import vcs from '../vcs';
import {
  readChannelSafelyAsync as readAndroidChannelSafelyAsync,
  readReleaseChannelSafelyAsync as readAndroidReleaseChannelSafelyAsync,
} from './android/UpdatesModule';
import { readVersionCodeAsync, readVersionNameAsync } from './android/version';
import { BuildContext } from './context';
import {
  readChannelSafelyAsync as readIosChannelSafelyAsync,
  readReleaseChannelSafelyAsync as readIosReleaseChannelSafelyAsync,
} from './ios/UpdatesModule';
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
  const channelOrReleaseChannel = await resolveChannelOrReleaseChannelAsync(ctx);
  return {
    trackingContext: ctx.trackingCtx,
    appVersion: await resolveAppVersionAsync(ctx),
    appBuildVersion: await resolveAppBuildVersionAsync(ctx),
    cliVersion: packageJSON.version,
    workflow: ctx.workflow,
    credentialsSource,
    sdkVersion: ctx.commandCtx.exp.sdkVersion,
    runtimeVersion: ctx.commandCtx.exp.runtimeVersion,
    ...channelOrReleaseChannel,
    distribution: ctx.buildProfile.distribution ?? 'store',
    appName: ctx.commandCtx.exp.name,
    appIdentifier: await resolveAppIdentifierAsync(ctx),
    buildProfile: ctx.commandCtx.profile,
    gitCommitHash: await vcs.getCommitHashAsync(),
    username: getUsername(ctx.commandCtx.exp, await ensureLoggedInAsync()),
    ...(ctx.platform === Platform.IOS && {
      iosEnterpriseProvisioning: resolveIosEnterpriseProvisioning(
        ctx as BuildContext<Platform.IOS>
      ),
    }),
  };
}

async function resolveAppVersionAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string | undefined> {
  if (ctx.platform === Platform.IOS) {
    return await readShortVersionAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  } else {
    return await readVersionNameAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  }
}

async function resolveAppBuildVersionAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string | undefined> {
  if (ctx.platform === Platform.IOS) {
    return await readBuildNumberAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  } else {
    const versionCode = await readVersionCodeAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
    return versionCode !== undefined ? String(versionCode) : undefined;
  }
}

async function resolveAppIdentifierAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string> {
  if (ctx.platform === Platform.IOS) {
    return await getBundleIdentifierAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  } else {
    return await getApplicationIdAsync(ctx.commandCtx.projectDir, ctx.commandCtx.exp);
  }
}

async function resolveChannelOrReleaseChannelAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<{ channel: string } | { releaseChannel: string } | null> {
  if (!isExpoUpdatesInstalled(ctx.commandCtx.projectDir)) {
    return null;
  }
  if (ctx.buildProfile.channel) {
    return { channel: ctx.buildProfile.channel };
  }
  if (ctx.buildProfile.releaseChannel) {
    return { releaseChannel: ctx.buildProfile.releaseChannel };
  }
  const channel = await getNativeChannelAsync(ctx);
  if (channel) {
    return { channel };
  }
  const releaseChannel = await getNativeReleaseChannelAsync(ctx);
  return { releaseChannel };
}

async function getNativeReleaseChannelAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string> {
  switch (ctx.platform) {
    case Platform.ANDROID: {
      return (await readAndroidReleaseChannelSafelyAsync(ctx.commandCtx.projectDir)) ?? 'default';
    }
    case Platform.IOS: {
      return (await readIosReleaseChannelSafelyAsync(ctx.commandCtx.projectDir)) ?? 'default';
    }
    default:
      return 'default';
  }
}

async function getNativeChannelAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string | undefined> {
  switch (ctx.platform) {
    case Platform.ANDROID: {
      return (await readAndroidChannelSafelyAsync(ctx.commandCtx.projectDir)) ?? undefined;
    }
    case Platform.IOS: {
      return (await readIosChannelSafelyAsync(ctx.commandCtx.projectDir)) ?? undefined;
    }
  }

  return undefined;
}

function resolveIosEnterpriseProvisioning(
  ctx: BuildContext<Platform.IOS>
): IosEnterpriseProvisioning | undefined {
  return ctx.buildProfile.enterpriseProvisioning;
}
