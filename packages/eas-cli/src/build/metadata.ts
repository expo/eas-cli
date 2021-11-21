import { Updates } from '@expo/config-plugins';
import { Metadata, Platform, sanitizeMetadata } from '@expo/eas-build-job';
import { IosEnterpriseProvisioning } from '@expo/eas-json';

<<<<<<< HEAD
import Log from '../log';
import { getApplicationIdAsync } from '../project/android/applicationId';
import { GradleBuildContext } from '../project/android/gradle';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
||||||| parent of 26f2ab54 (pass identifier from build to submit)
import { getApplicationIdAsync } from '../project/android/applicationId';
import { GradleBuildContext } from '../project/android/gradle';
import { getBundleIdentifierAsync } from '../project/ios/bundleIdentifier';
=======
>>>>>>> 26f2ab54 (pass identifier from build to submit)
import { getUsername } from '../project/projectUtils';
import { ensureLoggedInAsync } from '../user/actions';
import { easCliVersion } from '../utils/easCli';
import { getVcsClient } from '../vcs';
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

// TODO(JJ): Replace this with the getRuntimeVersionNullable function in @expo/config-plugins
function getRuntimeVersionNullable(
  ...[config, platform]: Parameters<typeof Updates.getRuntimeVersion>
): string | null {
  try {
    return Updates.getRuntimeVersion(config, platform);
  } catch (e) {
    Log.debug(e);
    return null;
  }
}

export async function collectMetadataAsync<T extends Platform>(
  ctx: BuildContext<T>
): Promise<Metadata> {
  const channelOrReleaseChannel = await resolveChannelOrReleaseChannelAsync(ctx);
  const distribution =
    ('simulator' in ctx.buildProfile && ctx.buildProfile.simulator
      ? 'simulator'
      : ctx.buildProfile.distribution) ?? 'store';
  const metadata = {
    trackingContext: ctx.trackingCtx,
    ...(await maybeResolveVersionsAsync(ctx)),
    cliVersion: easCliVersion,
    workflow: ctx.workflow,
    credentialsSource: ctx.buildProfile.credentialsSource,
    sdkVersion: ctx.exp.sdkVersion,
    runtimeVersion: getRuntimeVersionNullable(ctx.exp, ctx.platform) ?? undefined,
    ...channelOrReleaseChannel,
    distribution,
    appName: ctx.exp.name,
    appIdentifier: resolveAppIdentifier(ctx),
    buildProfile: ctx.buildProfileName,
    gitCommitHash: await getVcsClient().getCommitHashAsync(),
    isGitWorkingTreeDirty: await getVcsClient().hasUncommittedChangesAsync(),
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
  ctx: BuildContext<T>
): Promise<{ appBuildVersion?: string; appVersion?: string }> {
  if (ctx.platform === Platform.IOS) {
    const iosContext = ctx as BuildContext<Platform.IOS>;
    return await maybeResolveIosVersionsAsync(
      ctx.projectDir,
      ctx.exp,
      iosContext.ios.applicationTargetBuildSettings
    );
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

function resolveIosEnterpriseProvisioning(
  ctx: BuildContext<Platform.IOS>
): IosEnterpriseProvisioning | undefined {
  return ctx.buildProfile.enterpriseProvisioning;
}
