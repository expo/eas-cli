import { Updates } from '@expo/config-plugins';
import { Metadata, Platform, sanitizeMetadata } from '@expo/eas-build-job';
import { IosEnterpriseProvisioning } from '@expo/eas-json';
import fs from 'fs-extra';
import resolveFrom from 'resolve-from';

import Log from '../log';
import { getUsername, isExpoUpdatesInstalled } from '../project/projectUtils';
import {
  readChannelSafelyAsync as readAndroidChannelSafelyAsync,
  readReleaseChannelSafelyAsync as readAndroidReleaseChannelSafelyAsync,
} from '../update/android/UpdatesModule';
import {
  readChannelSafelyAsync as readIosChannelSafelyAsync,
  readReleaseChannelSafelyAsync as readIosReleaseChannelSafelyAsync,
} from '../update/ios/UpdatesModule';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/easCli';
import { getVcsClient } from '../vcs';
import { maybeResolveVersionsAsync as maybeResolveAndroidVersionsAsync } from './android/version';
import { BuildContext } from './context';
import { maybeResolveVersionsAsync as maybeResolveIosVersionsAsync } from './ios/version';

export async function collectMetadataAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<Metadata> {
  const vcsClient = getVcsClient();
  const channelOrReleaseChannel = await resolveChannelOrReleaseChannelAsync(ctx);
  const distribution =
    ('simulator' in ctx.buildProfile && ctx.buildProfile.simulator
      ? 'simulator'
      : ctx.buildProfile.distribution) ?? 'store';
  const metadata: Metadata = {
    trackingContext: ctx.trackingCtx,
    ...(await maybeResolveVersionsAsync(ctx)),
    cliVersion: easCliVersion,
    workflow: ctx.workflow,
    credentialsSource: ctx.buildProfile.credentialsSource,
    sdkVersion: ctx.exp.sdkVersion,
    runtimeVersion: Updates.getRuntimeVersionNullable(ctx.exp, ctx.platform) ?? undefined,
    reactNativeVersion: await getReactNativeVersionAsync(ctx),
    ...channelOrReleaseChannel,
    distribution,
    appName: ctx.exp.name,
    appIdentifier: resolveAppIdentifier(ctx),
    buildProfile: ctx.buildProfileName,
    gitCommitHash: await vcsClient.getCommitHashAsync(),
    gitCommitMessage: truncateGitCommitMessage(
      (await vcsClient.getLastCommitMessageAsync()) ?? undefined
    ),
    isGitWorkingTreeDirty: await vcsClient.hasUncommittedChangesAsync(),
    username: getUsername(ctx.exp, await ensureLoggedInAsync()),
    message: ctx.message,
    ...(ctx.platform === Platform.IOS && {
      iosEnterpriseProvisioning: resolveIosEnterpriseProvisioning(
        ctx as BuildContext<Platform.IOS>
      ),
    }),
  };
  return sanitizeMetadata(metadata);
}

async function maybeResolveVersionsAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<{ appBuildVersion?: string; appVersion?: string }> {
  if (ctx.platform === Platform.IOS) {
    const iosContext = ctx as BuildContext<Platform.IOS>;
    return await maybeResolveIosVersionsAsync(ctx.projectDir, ctx.exp, iosContext.ios.targets);
  } else if (ctx.platform === Platform.ANDROID) {
    const androidCtx = ctx as BuildContext<Platform.ANDROID>;
    return await maybeResolveAndroidVersionsAsync(ctx.projectDir, ctx.exp, androidCtx.buildProfile);
  } else {
    throw new Error(`Unsupported platform ${ctx.platform}`);
  }
}

function resolveAppIdentifier<T extends Platform>(ctx: BuildContext<T>): string {
  if (ctx.platform === Platform.IOS) {
    return (ctx as BuildContext<Platform.IOS>).ios.bundleIdentifier;
  } else {
    return (ctx as BuildContext<Platform.ANDROID>).android.applicationId;
  }
}

async function resolveChannelOrReleaseChannelAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<{ channel: string } | { releaseChannel: string } | null> {
  if (!isExpoUpdatesInstalled(ctx.projectDir)) {
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
      return (await readAndroidReleaseChannelSafelyAsync(ctx.projectDir)) ?? 'default';
    }
    case Platform.IOS: {
      return (await readIosReleaseChannelSafelyAsync(ctx.projectDir)) ?? 'default';
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
      return (await readAndroidChannelSafelyAsync(ctx.projectDir)) ?? undefined;
    }
    case Platform.IOS: {
      return (await readIosChannelSafelyAsync(ctx.projectDir)) ?? undefined;
    }
  }

  return undefined;
}

async function getReactNativeVersionAsync(
  ctx: BuildContext<Platform>
): Promise<string | undefined> {
  try {
    const reactNativePackageJsonPath = resolveFrom(ctx.projectDir, 'react-native/package.json');
    return (await fs.readJson(reactNativePackageJsonPath)).version;
  } catch (err) {
    Log.debug('Failed to resolve react-native version:');
    Log.debug(err);
    return undefined;
  }
}

function resolveIosEnterpriseProvisioning(
  ctx: BuildContext<Platform.IOS>
): IosEnterpriseProvisioning | undefined {
  return ctx.buildProfile.enterpriseProvisioning;
}

export function truncateGitCommitMessage(
  msg: string | undefined,
  maxLength: number = 4096
): string | undefined {
  if (msg === undefined) {
    return undefined;
  }
  return msg.length > maxLength ? `${msg.substring(0, maxLength - 3)}...` : msg;
}
