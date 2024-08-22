import { ExpoConfig } from '@expo/config';
import { format } from '@expo/timeago.js';
import chalk from 'chalk';
import dateFormat from 'dateformat';

import { getEASUpdateURL } from '../api';
import {
  Robot,
  SsoUser,
  Update,
  UpdateBranchFragment,
  UpdateFragment,
  User,
} from '../graphql/generated';
import { learnMore } from '../log';
import { RequestedPlatform } from '../platform';
import { getActorDisplayName } from '../user/User';
import groupBy from '../utils/expodash/groupBy';
import formatFields from '../utils/formatFields';

export type FormatUpdateParameter = Pick<Update, 'id' | 'createdAt' | 'message'> & {
  actor?:
    | Pick<Robot, '__typename' | 'firstName'>
    | Pick<User, '__typename' | 'username'>
    | Pick<SsoUser, '__typename' | 'username'>
    | null;
};

export type UpdateJsonInfo = { branch: string } & Pick<
  UpdateFragment,
  | 'id'
  | 'createdAt'
  | 'group'
  | 'message'
  | 'runtimeVersion'
  | 'platform'
  | 'manifestPermalink'
  | 'gitCommitHash'
>;

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
  codeSigningKey: string | undefined;
  isRollBackToEmbedded: boolean;
  rolloutPercentage: number | undefined;
};

export type FormattedBranchDescription = {
  branch: string;
  branchRolloutPercentage?: number;
  update?: FormattedUpdateGroupDescription;
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

export function formatUpdateGroup(update: FormattedUpdateGroupDescription): string {
  return formatFields([
    { label: 'Platforms', value: update.platforms },
    { label: 'Runtime Version', value: update.runtimeVersion },
    { label: 'Message', value: update.message },
    { label: 'Code Signing Key', value: update.codeSigningKey ?? 'N/A' },
    { label: 'Is Roll Back to Embedded', value: update.isRollBackToEmbedded ? 'Yes' : 'No' },
    {
      label: 'Rollout Percentage',
      value: update.rolloutPercentage !== undefined ? `${update.rolloutPercentage}%` : 'N/A',
    },
    { label: 'Group ID', value: update.group },
  ]);
}

export function formatBranch({
  branch,
  branchRolloutPercentage,
  update,
}: FormattedBranchDescription): string {
  const rolloutField = branchRolloutPercentage
    ? [{ label: 'Rollout', value: `${branchRolloutPercentage}%` }]
    : [];

  return formatFields([
    { label: 'Branch', value: branch },
    ...rolloutField,
    { label: 'Platforms', value: update?.platforms ?? 'N/A' },
    { label: 'Runtime Version', value: update?.runtimeVersion ?? 'N/A' },
    { label: 'Message', value: update?.message ?? 'N/A' },
    { label: 'Group ID', value: update?.group ?? 'N/A' },
  ]);
}

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
  return `${message}(${format(update.createdAt, 'en_US')} by ${getActorDisplayName(update.actor)})`;
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

export function formatUpdateTitle(update: UpdateFragment): string {
  const { message, createdAt, actor, runtimeVersion } = update;

  let actorName: string;
  switch (actor?.__typename) {
    case 'User':
    case 'SSOUser': {
      actorName = actor.username;
      break;
    }
    case 'Robot': {
      const { firstName, id } = actor;
      actorName = firstName ?? `robot: ${id.slice(0, 4)}...`;
      break;
    }
    case undefined: {
      actorName = 'unknown';
    }
  }
  return `[${dateFormat(
    createdAt,
    'mmm dd HH:MM'
  )} by ${actorName}, runtimeVersion: ${runtimeVersion}] ${message}`;
}

export function getUpdateJsonInfosForUpdates(updates: UpdateFragment[]): UpdateJsonInfo[] {
  return updates.map(update => ({
    id: update.id,
    createdAt: update.createdAt,
    group: update.group,
    branch: update.branch.name,
    message: update.message,
    runtimeVersion: update.runtimeVersion,
    platform: update.platform,
    manifestPermalink: update.manifestPermalink,
    isRollBackToEmbedded: update.isRollBackToEmbedded,
    gitCommitHash: update.gitCommitHash,
  }));
}

export function getUpdateGroupDescriptions(
  updateGroups: UpdateFragment[][]
): FormattedUpdateGroupDescription[] {
  return updateGroups.map(updateGroup => ({
    message: formatUpdateMessage(updateGroup[0]),
    runtimeVersion: updateGroup[0].runtimeVersion,
    isRollBackToEmbedded: updateGroup[0].isRollBackToEmbedded,
    rolloutPercentage: updateGroup[0].rolloutPercentage ?? undefined,
    codeSigningKey: updateGroup[0].codeSigningInfo?.keyid,
    group: updateGroup[0].group,
    platforms: formatPlatformForUpdateGroup(updateGroup),
  }));
}

export function getUpdateGroupDescriptionsWithBranch(
  updateGroups: UpdateFragment[][]
): FormattedUpdateGroupDescriptionWithBranch[] {
  return updateGroups.map(updateGroup => ({
    branch: updateGroup[0].branch.name,
    message: formatUpdateMessage(updateGroup[0]),
    runtimeVersion: updateGroup[0].runtimeVersion,
    isRollBackToEmbedded: updateGroup[0].isRollBackToEmbedded,
    rolloutPercentage: updateGroup[0].rolloutPercentage ?? undefined,
    codeSigningKey: updateGroup[0].codeSigningInfo?.keyid,
    group: updateGroup[0].group,
    platforms: formatPlatformForUpdateGroup(updateGroup),
  }));
}

export function getBranchDescription(branch: UpdateBranchFragment): FormattedBranchDescription {
  if (branch.updates.length === 0) {
    return { branch: branch.name };
  }

  const latestUpdate = branch.updates[0];
  return {
    branch: branch.name,
    update: {
      message: formatUpdateMessage(latestUpdate),
      runtimeVersion: latestUpdate.runtimeVersion,
      isRollBackToEmbedded: latestUpdate.isRollBackToEmbedded,
      rolloutPercentage: latestUpdate.rolloutPercentage ?? undefined,
      codeSigningKey: latestUpdate.codeSigningInfo?.keyid,
      group: latestUpdate.group,
      platforms: getPlatformsForGroup({
        group: latestUpdate.group,
        updates: branch.updates,
      }),
    },
  };
}

export async function checkEASUpdateURLIsSetAsync(
  exp: ExpoConfig,
  projectId: string
): Promise<boolean> {
  const configuredURL = exp.updates?.url;
  const expectedURL = getEASUpdateURL(projectId);

  return configuredURL === expectedURL;
}
