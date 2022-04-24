import { ExpoConfig, getConfig } from '@expo/config';
import { EasJsonReader } from '@expo/eas-json';
import { format } from '@expo/timeago.js';
import chalk from 'chalk';
import { getEASUpdateURL } from '../api';

import { Maybe, Robot, Update, User } from '../graphql/generated';
import Log, { learnMore } from '../log';
import { RequestedPlatform } from '../platform';
import { getProjectIdAsync } from '../project/projectUtils';
import { getActorDisplayName } from '../user/User';
import groupBy from '../utils/expodash/groupBy';
import { ProfileData } from '../utils/profiles';

export type FormatUpdateParameter = Pick<Update, 'id' | 'createdAt' | 'message'> & {
  actor?: Maybe<Pick<User, 'username' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
};

export const UPDATE_COLUMNS = [
  'Update message',
  'Update runtime version',
  'Update group ID',
  'Update platforms',
];

export function getPlatformsForGroup({
  group,
  updates,
}: {
  group: string;
  updates: { group: string; platform: string }[];
}): string {
  const groupedUpdates = groupBy(updates, update => update.group);
  if (Object.keys(groupedUpdates).length === 0) {
    return 'N/A';
  }
  return groupedUpdates[group]
    .map(update => update.platform)
    .sort()
    .join(', ');
}

export function formatUpdate(update: FormatUpdateParameter): string {
  if (!update) {
    return 'N/A';
  }
  const message = update.message ? `"${update.message}" ` : '';
  return `${message}(${format(update.createdAt, 'en_US')} by ${getActorDisplayName(
    update.actor as any
  )})`;
}

export function ensureValidVersions(exp: ExpoConfig, platform: RequestedPlatform): void {
  const error = new Error(
    `Couldn't find either ${chalk.bold('runtimeVersion')} or ${chalk.bold(
      'sdkVersion'
    )} to configure ${chalk.bold(
      'expo-updates'
    )}. Please specify at least one of these properties under the ${chalk.bold(
      'expo'
    )} key in ${chalk.bold('app.json')}. ${learnMore(
      'https://docs.expo.dev/eas-update/runtime-versions/'
    )}`
  );

  if (
    [RequestedPlatform.Android, RequestedPlatform.All].includes(platform) &&
    !(exp.android?.runtimeVersion || exp.runtimeVersion) &&
    !exp.sdkVersion
  ) {
    throw error;
  }
  if (
    [RequestedPlatform.Ios, RequestedPlatform.All].includes(platform) &&
    !(exp.ios?.runtimeVersion || exp.runtimeVersion) &&
    !exp.sdkVersion
  ) {
    throw error;
  }
}

export async function checkDeprecatedChannelConfigurationAsync(
  projectDir: string
): Promise<boolean> {
  const easJson = await new EasJsonReader(projectDir).readAsync();
  if (easJson.build && Object.entries(easJson.build).some(([, value]) => value.releaseChannel)) {
    Log.warn(`» One or more build profiles in your eas.json specify the "releaseChannel" property.
For EAS Update, you need to specify the "channel" property, or your build will not be able to receive any updates.
Update your eas.json manually, or run ${chalk.bold('eas update:configure')}.
${learnMore('https://docs.expo.dev/eas-update/getting-started/#configure-your-project')}`);
    Log.newLine();
    return true;
  }

  return false;
}

export async function checkBuildProfileConfigMatchesProjectConfigAsync(
  projectDir: string,
  buildProfile: ProfileData<'build'>
): Promise<boolean> {
  const { exp } = getConfig(projectDir, {
    skipSDKVersionRequirement: true,
    isPublicConfig: true,
  });
  if ((await checkEASUpdateURLIsSetAsync(exp)) && buildProfile.profile.releaseChannel) {
    Log.warn(`» Build profile ${chalk.bold(
      buildProfile.profileName
    )} in your eas.json specifies the "releaseChannel" property.
For EAS Update, you need to specify the "channel" property, or your build will not be able to receive any updates.
Update your eas.json manually, or run ${chalk.bold('eas update:configure')}.
${learnMore('https://docs.expo.dev/eas-update/getting-started/#configure-your-project')}`);
    return true;
  }

  return false;
}

export async function checkEASUpdateURLIsSetAsync(exp: ExpoConfig): Promise<boolean> {
  const configuredURL = exp.updates?.url;
  const projectId = await getProjectIdAsync(exp);
  const expectedURL = getEASUpdateURL(projectId);

  return configuredURL === expectedURL;
}

export async function ensureEASUpdateURLIsSetAsync(exp: ExpoConfig): Promise<void> {
  const configuredURL = exp.updates?.url;
  const projectId = await getProjectIdAsync(exp);
  const expectedURL = getEASUpdateURL(projectId);

  if (configuredURL !== expectedURL) {
    throw new Error(
      `The update URL is incorrectly configured for EAS Update. Please set updates.url to ${expectedURL} in your app.json.`
    );
  }
}
