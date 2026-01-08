import { BuildJob, Job, Metadata, Platform } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { ExpoConfig } from '@expo/config';

import {
  iosGetNativelyDefinedChannelAsync,
  iosSetChannelNativelyAsync,
  iosSetRuntimeVersionNativelyAsync,
} from './ios/expoUpdates';
import {
  androidGetNativelyDefinedChannelAsync,
  androidSetChannelNativelyAsync,
  androidSetRuntimeVersionNativelyAsync,
} from './android/expoUpdates';

export async function configureEASUpdateAsync({
  job,
  workingDirectory,
  logger,
  inputs,
  appConfig,
  metadata,
}: {
  job: BuildJob;
  workingDirectory: string;
  logger: bunyan;
  inputs: {
    runtimeVersion?: string;
    channel?: string;
    resolvedRuntimeVersion?: string;
  };
  appConfig: ExpoConfig;
  metadata: Metadata | null;
}): Promise<void> {
  const runtimeVersion =
    inputs.runtimeVersion ?? job.version?.runtimeVersion ?? inputs.resolvedRuntimeVersion;

  if (metadata?.runtimeVersion && metadata.runtimeVersion !== runtimeVersion) {
    logger.warn(
      `Runtime version from the app config evaluated on your local machine (${metadata.runtimeVersion}) does not match the one resolved here (${runtimeVersion}).`
    );
    logger.warn(
      "If you're using conditional app configs, e.g. depending on an environment variable, make sure to set the variable in eas.json or configure it with EAS environment variables."
    );
  }

  const jobOrInputChannel = inputs.channel ?? job.updates?.channel;

  if (isEASUpdateConfigured(appConfig, logger)) {
    if (jobOrInputChannel) {
      await configureEASUpdate(job, logger, jobOrInputChannel, workingDirectory);
    } else {
      const channel = await getChannelAsync(job, workingDirectory);
      const isDevelopmentClient = job.developmentClient ?? false;

      if (channel) {
        const configFile = job.platform === Platform.ANDROID ? 'AndroidManifest.xml' : 'Expo.plist';
        logger.info(`The channel name for EAS Update in ${configFile} is set to "${channel}"`);
      } else if (isDevelopmentClient) {
        // NO-OP: Development clients don't need to have a channel set
      } else {
        const easUpdateUrl = appConfig.updates?.url ?? null;
        const jobProfile = job.buildProfile ?? null;
        logger.warn(
          `This build has an invalid EAS Update configuration: update.url is set to "${easUpdateUrl}" in app config, but a channel is not specified${
            jobProfile ? '' : ` for the current build profile "${jobProfile}" in eas.json`
          }.`
        );
        logger.warn(`- No channel will be set and EAS Update will be disabled for the build.`);
        logger.warn(
          `- Run \`eas update:configure\` to set your channel in eas.json. For more details, see https://docs.expo.dev/eas-update/getting-started/#configure-your-project`
        );
      }
    }
  } else {
    logger.info(`Expo Updates is not configured, skipping configuring Expo Updates.`);
  }

  if (runtimeVersion) {
    logger.info('Updating runtimeVersion in Expo.plist');
    await setRuntimeVersionNativelyAsync(job, runtimeVersion, workingDirectory);
  }
}

export function isEASUpdateConfigured(appConfig: ExpoConfig, logger: bunyan): boolean {
  const rawUrl = appConfig.updates?.url;
  if (!rawUrl) {
    return false;
  }
  try {
    const url = new URL(rawUrl);
    return ['u.expo.dev', 'staging-u.expo.dev'].includes(url.hostname);
  } catch (err) {
    logger.error({ err }, `Cannot parse expo.updates.url = ${rawUrl} as URL`);
    logger.error(`Assuming EAS Update is not configured`);
    return false;
  }
}

async function configureEASUpdate(
  job: Job,
  logger: bunyan,
  channel: string,
  workingDirectory: string
): Promise<void> {
  const newUpdateRequestHeaders: Record<string, string> = {
    'expo-channel-name': channel,
  };

  const configFile = job.platform === Platform.ANDROID ? 'AndroidManifest.xml' : 'Expo.plist';
  logger.info(
    `Setting the update request headers in '${configFile}' to '${JSON.stringify(
      newUpdateRequestHeaders
    )}'`
  );

  switch (job.platform) {
    case Platform.ANDROID: {
      await androidSetChannelNativelyAsync(channel, workingDirectory);
      return;
    }
    case Platform.IOS: {
      await iosSetChannelNativelyAsync(channel, workingDirectory);
      return;
    }
    default:
      throw new Error(`Platform is not supported.`);
  }
}

async function getChannelAsync(job: Job, workingDirectory: string): Promise<string | null> {
  switch (job.platform) {
    case Platform.ANDROID: {
      return await androidGetNativelyDefinedChannelAsync(workingDirectory);
    }
    case Platform.IOS: {
      return await iosGetNativelyDefinedChannelAsync(workingDirectory);
    }
    default:
      throw new Error(`Platform is not supported.`);
  }
}

async function setRuntimeVersionNativelyAsync(
  job: Job,
  runtimeVersion: string,
  workingDirectory: string
): Promise<void> {
  switch (job.platform) {
    case Platform.ANDROID: {
      await androidSetRuntimeVersionNativelyAsync(runtimeVersion, workingDirectory);
      return;
    }
    case Platform.IOS: {
      await iosSetRuntimeVersionNativelyAsync(runtimeVersion, workingDirectory);
      return;
    }
    default:
      throw new Error(`Platform is not supported.`);
  }
}
