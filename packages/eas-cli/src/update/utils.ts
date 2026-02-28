import { ExpoConfig } from '@expo/config';
import { Errors } from '@oclif/core';
import { format } from '@expo/timeago.js';
import chalk from 'chalk';
import dateFormat from 'dateformat';
import semver from 'semver';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AppPlatform,
  Robot,
  SsoUser,
  Update,
  UpdateBranchFragment,
  UpdateFragment,
  UpdatePublishMutation,
  User,
} from '../graphql/generated';
import { AssetQuery } from '../graphql/queries/AssetQuery';
import { BranchQuery } from '../graphql/queries/BranchQuery';
import { learnMore } from '../log';
import { RequestedPlatform } from '../platform';
import { getActorDisplayName } from '../user/User';
import groupBy from '../utils/expodash/groupBy';
import formatFields from '../utils/formatFields';
import { boolish } from 'getenv';

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
    {
      label: 'Is Roll Back to Embedded',
      value: update.isRollBackToEmbedded ? 'Yes' : 'No',
    },
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

export function isBundleDiffingEnabled(exp: ExpoConfig): boolean {
  return (exp.updates as any)?.enableBsdiffPatchSupport === true;
}

// Make authenticated requests to the launch asset URL with diffing headers
export async function prewarmDiffingAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  newUpdates: UpdatePublishMutation['updateBranch']['publishUpdateGroups']
): Promise<void> {
  const DUMMY_EMBEDDED_UPDATE_ID = '00000000-0000-0000-0000-000000000000';

  const toPrewarm = [] as {
    update: UpdatePublishMutation['updateBranch']['publishUpdateGroups'][0];
    launchAssetKey: string;
  }[];

  for (const update of newUpdates) {
    const manifest = JSON.parse(update.manifestFragment);
    const launchAssetKey: string | undefined = manifest.launchAsset?.storageKey;
    const requestedUpdateId: string = update.id;
    if (!launchAssetKey || !requestedUpdateId) {
      continue;
    }
    toPrewarm.push({
      update,
      launchAssetKey,
    });
  }

  await Promise.allSettled(
    toPrewarm.map(async ({ update, launchAssetKey }) => {
      try {
        // Check to see if there's a second most recent update so we can pre-emptively generate a patch for it
        const updatePublishPlatform = update.platform as UpdatePublishPlatform;
        const updateIds = await BranchQuery.getUpdateIdsOnBranchAsync(graphqlClient, {
          appId,
          branchName: update.branch.name,
          platform: updatePublishPlatformToAppPlatform[updatePublishPlatform],
          runtimeVersion: update.runtimeVersion,
          limit: 2,
        });
        if (updateIds.length !== 2) {
          return;
        }
        const nextMostRecentUpdateId = updateIds[1];

        const signed = await AssetQuery.getSignedUrlsAsync(graphqlClient, update.id, [
          launchAssetKey,
        ]);
        const first = signed?.[0];
        if (!first) {
          return;
        }

        const headers: Record<string, string> = {
          ...(first.headers as Record<string, string> | undefined),
          'expo-current-update-id': nextMostRecentUpdateId,
          'expo-requested-update-id': update.id,
          'expo-embedded-update-id': DUMMY_EMBEDDED_UPDATE_ID,
          'a-im': 'bsdiff',
        };

        await fetch(first.url, {
          method: 'HEAD',
          headers,
          signal: AbortSignal.timeout(2500),
        });
      } catch {
        // ignore errors, best-effort optimization
      }
    })
  );
}

// update publish does not currently support web
export type UpdatePublishPlatform = 'ios' | 'android';

export const updatePublishPlatformToAppPlatform: Record<UpdatePublishPlatform, AppPlatform> = {
  android: AppPlatform.Android,
  ios: AppPlatform.Ios,
};

const environmentFlagOverride = 'EAS_UPDATE_SKIP_ENVIRONMENT_CHECK';

const ciEnvironmentFlags = ['EAS_BUILD', 'CI'];

export function assertEnvironmentFlagForSdk55OrGreater({
  sdkVersion,
  environment,
}: {
  sdkVersion: string | undefined;
  environment: string | undefined;
}): void {
  // Skip check if we are in a CI environment
  for (let flag of ciEnvironmentFlags) {
    if (process.env[flag]) {
      return;
    }
  }
  // Skip check if the override is set
  if (boolish(environmentFlagOverride, false)) {
    return;
  }
  if (sdkVersion && semver.gte(sdkVersion, '55.0.0') && !environment) {
    Errors.error(
      `--environment flag is required for projects using Expo SDK 55 or greater when publishing an update. You can override this check by setting ${environmentFlagOverride}=1.`,
      {
        exit: 1,
      }
    );
  }
}
