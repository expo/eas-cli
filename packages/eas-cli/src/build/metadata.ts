import { Workflow } from '@expo/eas-build-job';
import { CredentialsSource } from '@expo/eas-json';

import { getAppIdentifierAsync } from '../project/projectUtils';
import { gitCommitHashAsync } from '../utils/git';
import { readReleaseChannelSafelyAsync as readAndroidReleaseChannelSafelyAsync } from './android/UpdatesModule';
import { BuildContext } from './context';
import { readReleaseChannelSafelyAsync as readIosReleaseChannelSafelyAsync } from './ios/UpdatesModule';
import { BuildMetadata, Platform } from './types';
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
): Promise<BuildMetadata> {
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
    appIdentifier:
      (await getAppIdentifierAsync(ctx.commandCtx.projectDir, ctx.platform)) ?? undefined,
    buildProfile: ctx.commandCtx.profile,
    gitCommitHash: await gitCommitHashAsync(),
  };
}

async function resolveReleaseChannel<T extends Platform>(
  ctx: BuildContext<T>
): Promise<string | undefined> {
  if (ctx.buildProfile.releaseChannel) {
    return ctx.buildProfile.releaseChannel;
  }

  let maybeReleaseChannel: string | null;
  if (ctx.platform === Platform.ANDROID) {
    maybeReleaseChannel = await readAndroidReleaseChannelSafelyAsync(ctx.commandCtx.projectDir);
  } else {
    maybeReleaseChannel = await readIosReleaseChannelSafelyAsync(ctx.commandCtx.projectDir);
  }
  if (maybeReleaseChannel) {
    return maybeReleaseChannel;
  }

  if (ctx.buildProfile.workflow === Workflow.GENERIC) {
    if (isExpoUpdatesInstalled(ctx.commandCtx.projectDir)) {
      return 'default';
    } else {
      return undefined;
    }
  } else {
    return 'default';
  }
}
