import { ExpoConfig } from '@expo/config';
import { format } from '@expo/timeago.js';
import chalk from 'chalk';
import dateFormat from 'dateformat';

import { Maybe, Robot, Update, User } from '../graphql/generated';
import { BranchUpdateObject, UpdateGroupObject } from '../graphql/queries/UpdateQuery';
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

export type FormattedUpdateGroupDescription = {
  message: string;
  group: string;
  platforms: string;
  runtimeVersion: string;
};

export type FormattedUpdateGroupDescriptionWithBranch = FormattedUpdateGroupDescription & {
  branch: string;
};

export const UPDATE_COLUMNS = [
  'Update message',
  'Update runtime version',
  'Update group ID',
  'Update platforms',
];

export const UPDATE_COLUMNS_WITH_BRANCH = ['Branch', ...UPDATE_COLUMNS];

export function getPlatformsForGroup({
  group,
  updates = [],
}: {
  group: string | undefined;
  updates: { group: string; platform: string }[] | undefined;
}): string {
  const groupedUpdates = groupBy(updates, update => update.group);
  return formatPlatformForUpdateGroup(group ? groupedUpdates[group] : undefined);
}

export function formatPlatformForUpdateGroup(
  updateGroup:
    | {
        group: string;
        platform: string;
      }[]
    | undefined
): string {
  return !updateGroup || updateGroup.length === 0
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

export function formatUpdateMessage(update: FormatUpdateParameter): string {
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
    )}. Specify at least one of these properties under the ${chalk.bold(
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

export function formatUpdateTitle(update: UpdateGroupObject[number] | BranchUpdateObject): string {
  const { message, createdAt, actor, runtimeVersion } = update;

  let actorName: string;
  switch (actor?.__typename) {
    case 'User': {
      actorName = (actor as Pick<User, 'username' | 'id'>).username;
      break;
    }
    case 'Robot': {
      const { firstName, id } = actor as Pick<Robot, 'firstName' | 'id'>;
      actorName = firstName ?? `robot: ${id.slice(0, 4)}...`;
      break;
    }
    default:
      actorName = 'unknown';
  }
  return `[${dateFormat(
    createdAt,
    'mmm dd HH:MM'
  )} by ${actorName}, runtimeVersion: ${runtimeVersion}] ${message}`;
}

export function getUpdateGroupDescriptions(
  updateGroups: UpdateGroupObject[]
): FormattedUpdateGroupDescription[] {
  return updateGroups.map(updateGroup => ({
    message: formatUpdateMessage(updateGroup[0]),
    runtimeVersion: updateGroup[0].runtimeVersion,
    group: updateGroup[0].group,
    platforms: formatPlatformForUpdateGroup(updateGroup),
  }));
}

export function getUpdateGroupDescriptionsWithBranch(
  updateGroups: UpdateGroupObject[]
): FormattedUpdateGroupDescriptionWithBranch[] {
  return updateGroups.map(updateGroup => ({
    branch: updateGroup[0].branch.name,
    message: formatUpdateMessage(updateGroup[0]),
    runtimeVersion: updateGroup[0].runtimeVersion,
    group: updateGroup[0].group,
    platforms: formatPlatformForUpdateGroup(updateGroup),
  }));
}
