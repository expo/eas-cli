import { ExpoConfig } from '@expo/config';
import { format } from '@expo/timeago.js';
import chalk from 'chalk';

import { Maybe, Robot, Update, User } from '../graphql/generated';
import { learnMore } from '../log';
import { RequestedPlatform } from '../platform';
import { getActorDisplayName } from '../user/User';
import groupBy from '../utils/expodash/groupBy';

export type FormatUpdateParameter = Pick<Update, 'id' | 'createdAt' | 'message'> & {
  actor?: Maybe<Pick<User, 'username' | 'id'> | Pick<Robot, 'firstName' | 'id'>>;
};

export type UpdateGroupDescription = FormatUpdateParameter & {
  branch: string;
  group: string;
  platforms: string;
  runtimeVersion: string;
};

export const UPDATE_COLUMNS = [
  'Update message',
  'Update runtime version',
  'Update group ID',
  'Update platforms',
];

export function getUpdateGroupsWithPlatforms<
  UpdateFragment extends Pick<Update, 'platform' | 'group'>
>(updates: UpdateFragment[]): (UpdateFragment & { platforms: string })[] {
  return Object.values(groupBy(updates, updates => updates.group)).map(updateGroup => ({
    ...updateGroup[0],
    platforms: formatPlatformForUpdateGroup(updateGroup),
  }));
}

export function getPlatformsForGroup({
  group,
  updates,
}: {
  group: string;
  updates: { group: string; platform: string }[];
}): string {
  const groupedUpdates = groupBy(updates, update => update.group);
  return formatPlatformForUpdateGroup(groupedUpdates[group]);
}

export function formatPlatformForUpdateGroup(
  updateGroup: {
    group: string;
    platform: string;
  }[]
): string {
  return updateGroup.length === 0
    ? 'N/A'
    : updateGroup
        .map(update => update.platform)
        .sort()
        .join(', ');
}

export function truncateString(originalMessage: string, length: number = 512): string {
  if (originalMessage.length > length) {
    return originalMessage.substring(0, length - 3) + '...';
  }
  return originalMessage;
}

export function formatUpdate(update: FormatUpdateParameter): string {
  if (!update) {
    return 'N/A';
  }
  const message = update.message ? `"${truncateString(update.message)}" ` : '';
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
