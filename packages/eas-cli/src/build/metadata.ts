import { Metadata, Platform, sanitizeMetadata } from '@expo/eas-build-job';
import { IosEnterpriseProvisioning } from '@expo/eas-json';
import type { XCBuildConfiguration } from 'xcode';

import { getApplicationIdAsync } from '../project/android/applicationId';
import { GradleBuildContext } from '../project/android/gradle';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
import { getUsername } from '../project/projectUtils';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/cli';
import vcs from '../vcs';
import {
  readChannelSafelyAsync as readAndroidChannelSafelyAsync,
  readReleaseChannelSafelyAsync as readAndroidReleaseChannelSafelyAsync,
} from './android/UpdatesModule';
import { maybeResolveVersionsAsync as maybeResolveAndroidVersionsAsync } from './android/version';
import { BuildContext } from './context';
import {
  readChannelSafelyAsync as readIosChannelSafelyAsync,
  readReleaseChannelSafelyAsync as readIosReleaseChannelSafelyAsync,
} from './ios/UpdatesModule';
import { maybeResolveVersionsAsync as maybeResolveIosVersionsAsync } from './ios/version';
import { isExpoUpdatesInstalled } from './utils/updates';

export type MetadataContext<T extends Platform> = T extends Platform.ANDROID
  ? AndroidMetadataContext
  : IosMetadataContext;

export interface AndroidMetadataContext {
  gradleContext?: GradleBuildContext;
}
export interface IosMetadataContext {
  buildSettings: XCBuildConfiguration['buildSettings'];
  targetName?: string;
  buildConfiguration?: string;
}

export async function collectMetadataAsync<T extends Platform>(
  ctx: BuildContext<T>,
  platformContext: MetadataContext<T>
): Promise<Metadata> {
  const channelOrReleaseChannel = await resolveChannelOrReleaseChannelAsync(ctx);
  const distribution =
    ('simulator' in ctx.buildProfile && ctx.buildProfile.simulator
      ? 'simulator'
      : ctx.buildProfile.distribution) ?? 'store';
  const metadata = {
    trackingContext: ctx.trackingCtx,
    ...(await maybeResolveVersionsAsync(ctx, platformContext)),
    cliVersion: easCliVersion,
    workflow: ctx.workflow,
    credentialsSource: ctx.buildProfile.credentialsSource,
    sdkVersion: ctx.exp.sdkVersion,
    runtimeVersion: ctx.exp.runtimeVersion,
    ...channelOrReleaseChannel,
    distribution,
    appName: ctx.exp.name,
    appIdentifier: await resolveAppIdentifierAsync(ctx, platformContext),
    buildProfile: ctx.buildProfileName,
    gitCommitHash: await vcs().getCommitHashAsync(),
    isGitWorkingTreeDirty: await vcs().hasUncommittedChangesAsync(),
    username: getUsername(ctx.exp, await ensureLoggedInAsync()),
    ...(ctx.platform === Platform.IOS && {
      iosEnterpriseProvisioning: resolveIosEnterpriseProvisioning(
        ctx as BuildContext<Platform.IOS>
      ),
    }),
  };
  return sanitizeMetadata(metadata);
}

async function maybeResolveVersionsAsync<T extends Platform>(
  ctx: BuildContext<T>,
  platformContext: MetadataContext<T>
): Promise<{ appBuildVersion?: string; appVersion?: string }> {
  if (ctx.platform === Platform.IOS) {
    const iosContext = platformContext as IosMetadataContext;
    return await maybeResolveIosVersionsAsync(
      ctx.projectDir,
      ctx.exp,
      iosContext?.buildSettings ?? {}
    );
  } else if (ctx.platform === Platform.ANDROID) {
    const androidCtx = ctx as BuildContext<Platform.ANDROID>;
    return await maybeResolveAndroidVersionsAsync(ctx.projectDir, ctx.exp, androidCtx.buildProfile);
  } else {
    throw new Error(`Unsupported platform ${ctx.platform}`);
  }
}

async function resolveAppIdentifierAsync<T extends Platform>(
  ctx: BuildContext<T>,
  platformContext: MetadataContext<T>
): Promise<string> {
  if (ctx.platform === Platform.IOS) {
    const iosContext = platformContext as IosMetadataContext;
    return await getBundleIdentifierAsync(ctx.projectDir, ctx.exp, {
      targetName: iosContext.targetName,
      buildConfiguration: iosContext.buildConfiguration,
    });
  } else {
    const androidContext = platformContext as AndroidMetadataContext;
    return await getApplicationIdAsync(ctx.projectDir, ctx.exp, androidContext.gradleContext);
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

function resolveIosEnterpriseProvisioning(
  ctx: BuildContext<Platform.IOS>
): IosEnterpriseProvisioning | undefined {
  return ctx.buildProfile.enterpriseProvisioning;
}
