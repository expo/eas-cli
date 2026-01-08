import assert from 'assert';
import os from 'os';
import path from 'path';

import { v4 as uuidv4 } from 'uuid';
import { Platform, Job, BuildJob, Workflow } from '@expo/eas-build-job';
import semver from 'semver';
import { ExpoConfig } from '@expo/config';
import { bunyan } from '@expo/logger';
import { BuildStepEnv } from '@expo/steps';
import fetch from 'node-fetch';
import fs from 'fs-extra';
import { graphql } from 'gql.tada';

import {
  androidSetRuntimeVersionNativelyAsync,
  androidSetChannelNativelyAsync,
  androidGetNativelyDefinedRuntimeVersionAsync,
  androidGetNativelyDefinedChannelAsync,
} from '../android/expoUpdates';
import {
  iosSetRuntimeVersionNativelyAsync,
  iosSetChannelNativelyAsync,
  iosGetNativelyDefinedRuntimeVersionAsync,
  iosGetNativelyDefinedChannelAsync,
} from '../ios/expoUpdates';
import { BuildContext } from '../context';

import getExpoUpdatesPackageVersionIfInstalledAsync from './getExpoUpdatesPackageVersionIfInstalledAsync';
import { resolveRuntimeVersionAsync } from './resolveRuntimeVersionAsync';
import { diffFingerprintsAsync } from './diffFingerprintsAsync';
import { stringifyFingerprintDiff } from './fingerprint';

export async function setRuntimeVersionNativelyAsync(
  ctx: BuildContext<Job>,
  runtimeVersion: string
): Promise<void> {
  switch (ctx.job.platform) {
    case Platform.ANDROID: {
      await androidSetRuntimeVersionNativelyAsync(ctx, runtimeVersion);
      return;
    }
    case Platform.IOS: {
      await iosSetRuntimeVersionNativelyAsync(ctx, runtimeVersion);
      return;
    }
    default:
      throw new Error(`Platform is not supported.`);
  }
}

/**
 * Used for when Expo Updates is pointed at an EAS server.
 */
export async function setChannelNativelyAsync(ctx: BuildContext<BuildJob>): Promise<void> {
  assert(ctx.job.updates?.channel, 'updates.channel must be defined');
  const newUpdateRequestHeaders: Record<string, string> = {
    'expo-channel-name': ctx.job.updates.channel,
  };

  const configFile = ctx.job.platform === Platform.ANDROID ? 'AndroidManifest.xml' : 'Expo.plist';
  ctx.logger.info(
    `Setting the update request headers in '${configFile}' to '${JSON.stringify(
      newUpdateRequestHeaders
    )}'`
  );

  switch (ctx.job.platform) {
    case Platform.ANDROID: {
      await androidSetChannelNativelyAsync(ctx);
      return;
    }
    case Platform.IOS: {
      await iosSetChannelNativelyAsync(ctx);
      return;
    }
    default:
      throw new Error(`Platform is not supported.`);
  }
}

export async function configureEASExpoUpdatesAsync(ctx: BuildContext<BuildJob>): Promise<void> {
  await setChannelNativelyAsync(ctx);
}

type ResolvedRuntime = {
  resolvedRuntimeVersion: string | null;
  resolvedFingerprintSources?: object[] | null;
};

export async function configureExpoUpdatesIfInstalledAsync(
  ctx: BuildContext<BuildJob>,
  resolvedRuntime: ResolvedRuntime
): Promise<void> {
  const expoUpdatesPackageVersion = await getExpoUpdatesPackageVersionIfInstalledAsync(
    ctx.getReactNativeProjectDirectory(),
    ctx.logger
  );
  if (expoUpdatesPackageVersion === null) {
    return;
  }

  const appConfigRuntimeVersion =
    ctx.job.version?.runtimeVersion ?? resolvedRuntime.resolvedRuntimeVersion;

  if (ctx.metadata?.runtimeVersion && ctx.metadata.runtimeVersion !== appConfigRuntimeVersion) {
    ctx.logger.warn(
      `
Runtime version mismatch:
- Runtime version calculated on local machine: ${ctx.metadata.runtimeVersion}
- Runtime version calculated on EAS: ${appConfigRuntimeVersion}

This may be due to one or more factors:
- Differing result of conditional app config (app.config.js) evaluation for runtime version resolution.
- Differing fingerprint when using fingerprint runtime version policy. If applicable, see fingerprint diff below.

This would cause any updates published on the local machine to not be compatible with this build.
`
    );
    await logDiffFingerprints({ resolvedRuntime, ctx });
    throw new Error(
      'Runtime version calculated on local machine not equal to runtime version calculated during build.'
    );
  }

  if (isEASUpdateConfigured(ctx)) {
    if (ctx.job.updates?.channel !== undefined) {
      await configureEASExpoUpdatesAsync(ctx);
    } else {
      const channel = await getChannelAsync(ctx);
      const isDevelopmentClient = ctx.job.developmentClient ?? false;

      if (channel !== null) {
        const configFile =
          ctx.job.platform === Platform.ANDROID ? 'AndroidManifest.xml' : 'Expo.plist';
        ctx.logger.info(`The channel name for EAS Update in ${configFile} is set to "${channel}"`);
      } else if (isDevelopmentClient) {
        // NO-OP: Development clients don't need to have a channel set
      } else {
        const easUpdateUrl = ctx.appConfig.updates?.url ?? null;
        const jobProfile = ctx.job.buildProfile ?? null;
        ctx.logger.warn(
          `This build has an invalid EAS Update configuration: update.url is set to "${easUpdateUrl}" in app config, but a channel is not specified${
            jobProfile ? '' : ` for the current build profile "${jobProfile}" in eas.json`
          }.`
        );
        ctx.logger.warn(`- No channel will be set and EAS Update will be disabled for the build.`);
        ctx.logger.warn(
          `- Run \`eas update:configure\` to set your channel in eas.json. For more details, see https://docs.expo.dev/eas-update/getting-started/#configure-your-project`
        );

        ctx.markBuildPhaseHasWarnings();
      }
    }
  }

  if (ctx.job.version?.runtimeVersion) {
    ctx.logger.info('Updating runtimeVersion in Expo.plist');
    await setRuntimeVersionNativelyAsync(ctx, ctx.job.version.runtimeVersion);
  }
}

export async function resolveRuntimeVersionForExpoUpdatesIfConfiguredAsync({
  cwd,
  appConfig,
  platform,
  workflow,
  logger,
  env,
}: {
  cwd: string;
  appConfig: ExpoConfig;
  platform: Platform;
  workflow: Workflow;
  logger: bunyan;
  env: BuildStepEnv;
}): Promise<{
  runtimeVersion: string | null;
  fingerprintSources: object[] | null;
} | null> {
  const expoUpdatesPackageVersion = await getExpoUpdatesPackageVersionIfInstalledAsync(cwd, logger);
  if (expoUpdatesPackageVersion === null) {
    return null;
  }

  const resolvedRuntimeVersion = await resolveRuntimeVersionAsync({
    projectDir: cwd,
    exp: appConfig,
    platform,
    workflow,
    logger,
    expoUpdatesPackageVersion,
    env,
  });

  logger.info(`Resolved runtime version: ${resolvedRuntimeVersion?.runtimeVersion}`);
  return resolvedRuntimeVersion;
}

export async function getChannelAsync(ctx: BuildContext<Job>): Promise<string | null> {
  switch (ctx.job.platform) {
    case Platform.ANDROID: {
      return await androidGetNativelyDefinedChannelAsync(ctx);
    }
    case Platform.IOS: {
      return await iosGetNativelyDefinedChannelAsync(ctx);
    }
    default:
      throw new Error(`Platform is not supported.`);
  }
}

export async function getRuntimeVersionAsync(ctx: BuildContext<Job>): Promise<string | null> {
  switch (ctx.job.platform) {
    case Platform.ANDROID: {
      return await androidGetNativelyDefinedRuntimeVersionAsync(ctx);
    }
    case Platform.IOS: {
      return await iosGetNativelyDefinedRuntimeVersionAsync(ctx);
    }
    default:
      throw new Error(`Platform is not supported.`);
  }
}

export function isEASUpdateConfigured(ctx: BuildContext<Job>): boolean {
  const rawUrl = ctx.appConfig.updates?.url;
  if (!rawUrl) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    return ['u.expo.dev', 'staging-u.expo.dev'].includes(url.hostname);
  } catch (err) {
    ctx.logger.error({ err }, `Cannot parse expo.updates.url = ${rawUrl} as URL`);
    ctx.logger.error(`Assuming EAS Update is not configured`);
    return false;
  }
}

export function isModernExpoUpdatesCLIWithRuntimeVersionCommandSupported(
  expoUpdatesPackageVersion: string
): boolean {
  if (expoUpdatesPackageVersion.includes('canary')) {
    return true;
  }

  // Anything SDK 51 or greater uses the expo-updates CLI
  return semver.gte(expoUpdatesPackageVersion, '0.25.4');
}

async function logDiffFingerprints({
  resolvedRuntime,
  ctx,
}: {
  resolvedRuntime: ResolvedRuntime;
  ctx: BuildContext<BuildJob>;
}): Promise<void> {
  const { resolvedRuntimeVersion, resolvedFingerprintSources } = resolvedRuntime;

  const fingerprintInfo = await ctx.graphqlClient
    .query(
      graphql(`
        query GetFingerprintUrl($id: ID!) {
          builds {
            byId(buildId: $id) {
              fingerprint {
                debugInfoUrl
              }
            }
          }
        }
      `),
      { id: ctx.env.EAS_BUILD_ID }
    )
    .toPromise();

  if (fingerprintInfo.error) {
    ctx.logger.warn('Failed to fetch current fingerprint info', fingerprintInfo.error);
    return;
  }

  if (
    fingerprintInfo.data?.builds.byId?.fingerprint?.debugInfoUrl &&
    resolvedFingerprintSources &&
    resolvedRuntimeVersion
  ) {
    try {
      const result = await fetch(fingerprintInfo.data.builds.byId.fingerprint.debugInfoUrl);
      const localFingerprintJSON = await result.json();
      const localFingerprintFile = path.join(
        os.tmpdir(),
        `eas-build-${uuidv4()}-local-fingerprint`
      );
      await fs.writeFile(localFingerprintFile, JSON.stringify(localFingerprintJSON));

      const easFingerprint = {
        hash: resolvedRuntimeVersion,
        sources: resolvedFingerprintSources,
      };
      const easFingerprintFile = path.join(os.tmpdir(), `eas-build-${uuidv4()}-eas-fingerprint`);
      await fs.writeFile(easFingerprintFile, JSON.stringify(easFingerprint));

      const changesJSONString = await diffFingerprintsAsync(
        ctx.getReactNativeProjectDirectory(),
        localFingerprintFile,
        easFingerprintFile,
        { env: ctx.env, logger: ctx.logger }
      );
      if (changesJSONString) {
        const changes = JSON.parse(changesJSONString);
        if (changes.length) {
          ctx.logger.warn('Difference between local and EAS fingerprints:');
          ctx.logger.warn(stringifyFingerprintDiff(changes));
        }
      }
    } catch (error) {
      ctx.logger.warn('Failed to compare fingerprints', error);
    }
  }
}
