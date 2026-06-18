import { ExpoConfig } from '@expo/config';
import { format } from '@expo/timeago.js';
import chalk from 'chalk';
import dateFormat from 'dateformat';
import semver from 'semver';

import { getBranchIds, getBranchMapping } from '../channel/branch-mapping';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import fetch from '../fetch';
import {
  AppPlatform,
  PartnerActor,
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
import { ChannelQuery } from '../graphql/queries/ChannelQuery';
import { EmbeddedUpdateQuery } from '../graphql/queries/EmbeddedUpdateQuery';
import Log, { learnMore } from '../log';
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
    | Pick<PartnerActor, '__typename' | 'username'>
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
    case 'PartnerActor':
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

// A bsdiff patch that was successfully pre-warmed: from a base update (and its embedded bundle) to
// the newly published `requestedUpdateId`.
interface PrewarmedDiff {
  requestedUpdateId: string;
  currentUpdateId: string;
  embeddedUpdateId: string;
}

// Upper bound on the number of channels we inspect when resolving which channels route to a
// published update's branch. Apps rarely have more than a handful; this just bounds pathological
// cases for what is a best-effort optimization.
const PREWARM_CHANNELS_LIMIT = 100;

// Resolve the names of channels whose branch mapping routes to the given branch. The GraphQL API
// has no branch->channels lookup (the mapping lives on the channel), so — as elsewhere in eas-cli
// and on the website — we fetch the channels once and evaluate their branchMapping locally.
async function getChannelNamesForBranchAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  branchId: string
): Promise<string[]> {
  const channels = await ChannelQuery.viewUpdateChannelsBasicInfoPaginatedOnAppAsync(
    graphqlClient,
    {
      appId,
      first: PREWARM_CHANNELS_LIMIT,
    }
  );
  return channels.edges
    .map(edge => edge.node)
    .filter(channel => getBranchIds(getBranchMapping(channel.branchMapping)).includes(branchId))
    .map(channel => channel.name);
}

// Pre-warm bsdiff patches from a set of base updates to a single newly published update by making
// authenticated HEAD requests to its launch asset url with diffing headers. Best-effort: any
// failure is logged and swallowed so it never blocks a publish. Returns the patches that were
// successfully warmed.
async function prewarmUpdateDiffsAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  update: UpdatePublishMutation['updateBranch']['publishUpdateGroups'][number],
  launchAssetKey: string
): Promise<PrewarmedDiff[]> {
  try {
    // Sentinel embedded update id used when a project has no registered embedded bundle to diff
    // against. Mirrors the "empty default" the server falls back to.
    const DUMMY_EMBEDDED_UPDATE_ID = '00000000-0000-0000-0000-000000000000';

    // Number of most recent updates on the branch to pre-warm bsdiff patches against. Clients running
    // any of these can be served a precomputed patch instead of an on-demand diff.
    const PREWARM_RECENT_UPDATES_LIMIT = 5;

    // Number of registered embedded bundles (roughly one per native binary in the field) to pre-warm
    // patches against. Each represents a fresh-install scenario.
    const PREWARM_EMBEDDED_UPDATES_LIMIT = 2;

    const updatePublishPlatform = update.platform as UpdatePublishPlatform;
    const platform = updatePublishPlatformToAppPlatform[updatePublishPlatform];

    // Baseline: pre-warm patches against the most recent updates on the branch so that clients
    // currently running any of them can be served a precomputed bsdiff patch.
    const recentUpdateIds = await BranchQuery.getUpdateIdsOnBranchAsync(graphqlClient, {
      appId,
      branchName: update.branch.name,
      platform,
      runtimeVersion: update.runtimeVersion,
      limit: PREWARM_RECENT_UPDATES_LIMIT,
      offset: 1, // skip the current update
    });
    Log.debug(
      `Found ${recentUpdateIds.length} recent update(s) on branch ${update.branch.name} to diff update ${update.id} against: ${recentUpdateIds.join(', ')}`
    );

    if (recentUpdateIds.length === 0) {
      Log.debug(`No recent updates to pre-warm for update ${update.id}, skipping`);
      return [];
    }

    const signed = await AssetQuery.getSignedUrlsAsync(graphqlClient, update.id, [launchAssetKey]);
    const first = signed?.[0];
    if (!first) {
      Log.debug(`No signed launch asset URL for update ${update.id}, skipping pre-warming`);
      return [];
    }

    // Pre-warm the patch from the bundle embedded in the native binary to the new update.
    // This is what fresh installs request, so generating it ahead of time avoids an
    // expensive on-demand diff. Falls back to the empty/default embedded id when the project has no
    // registered embedded bundle.
    //
    // Embedded bundles are channel-scoped, so only builds whose channel routes (via branch mapping)
    // to this update's branch can ever request it. Resolve those channels and let the server filter
    // embedded updates down to them — pre-warming any other channel's bundle would be wasted work.
    const channelNames = await getChannelNamesForBranchAsync(
      graphqlClient,
      appId,
      update.branch.id
    );
    Log.debug(
      `Found ${channelNames.length} channel(s) routing to branch ${update.branch.name} for update ${update.id}: ${channelNames.join(', ')}`
    );

    const embeddedUpdateIdSet = new Set<string>();
    for (const channel of channelNames) {
      if (embeddedUpdateIdSet.size >= PREWARM_EMBEDDED_UPDATES_LIMIT) {
        break;
      }
      const embeddedUpdateQuery = await EmbeddedUpdateQuery.viewPaginatedAsync(graphqlClient, {
        appId,
        filter: { platform, runtimeVersion: update.runtimeVersion, channel },
        first: PREWARM_EMBEDDED_UPDATES_LIMIT,
      });
      for (const edge of embeddedUpdateQuery.edges) {
        embeddedUpdateIdSet.add(edge.node.id);
      }
    }
    const embeddedUpdateIds = [...embeddedUpdateIdSet].slice(0, PREWARM_EMBEDDED_UPDATES_LIMIT);
    Log.debug(
      `Found ${embeddedUpdateIds.length} embedded bundle(s) for update ${update.id}: ${embeddedUpdateIds.join(', ')}`
    );

    const warmupRequests: { updateId: string; embeddedUpdateId: string }[] = [];

    // pre-warm update from embedded bundle(s) to the new update
    if (embeddedUpdateIds.length > 0) {
      for (const embeddedUpdateId of embeddedUpdateIds) {
        warmupRequests.push({ updateId: embeddedUpdateId, embeddedUpdateId });
      }
    }

    // pre-warm top-K of recent updates
    for (const updateId of recentUpdateIds) {
      if (!embeddedUpdateIds.includes(updateId)) {
        const embeddedUpdateId =
          embeddedUpdateIds.length > 0 ? embeddedUpdateIds[0] : DUMMY_EMBEDDED_UPDATE_ID;
        warmupRequests.push({ updateId, embeddedUpdateId });
      }
    }

    Log.debug(`Pre-warming ${warmupRequests.length} patch(es) for update ${update.id}`);
    const settled = await Promise.allSettled(
      warmupRequests.map(async ({ updateId, embeddedUpdateId }): Promise<PrewarmedDiff> => {
        const headers: Record<string, string> = {
          ...(first.headers as Record<string, string> | undefined),
          'expo-current-update-id': updateId,
          'expo-requested-update-id': update.id,
          'expo-embedded-update-id': embeddedUpdateId,
          'a-im': 'bsdiff',
        };

        Log.debug(
          `Pre-warming patch for update ${update.id} from current update ${updateId} (embedded update ${embeddedUpdateId})`
        );
        await fetch(first.url, {
          method: 'HEAD',
          headers,
          signal: AbortSignal.timeout(2500),
        });
        return {
          requestedUpdateId: update.id,
          currentUpdateId: updateId,
          embeddedUpdateId,
        };
      })
    );
    return settled
      .filter(
        (result): result is PromiseFulfilledResult<PrewarmedDiff> => result.status === 'fulfilled'
      )
      .map(result => result.value);
  } catch (e) {
    // ignore errors, best-effort optimization
    Log.debug(`Pre-warming diffing failed for update ${update.id}:`, e);
    return [];
  }
}

// Make authenticated requests to the launch asset URL with diffing headers. Returns the bsdiff
// patches that were successfully pre-warmed across all of the given updates.
export async function prewarmDiffingAsync(
  graphqlClient: ExpoGraphqlClient,
  appId: string,
  newUpdates: UpdatePublishMutation['updateBranch']['publishUpdateGroups']
): Promise<PrewarmedDiff[]> {
  const toPrewarm = [] as {
    update: UpdatePublishMutation['updateBranch']['publishUpdateGroups'][number];
    launchAssetKey: string;
  }[];

  Log.debug(`Considering ${newUpdates.length} update(s) for bsdiff pre-warming`);

  for (const update of newUpdates) {
    const manifest = JSON.parse(update.manifestFragment);
    const launchAssetKey: string | undefined = manifest.launchAsset?.storageKey;
    const requestedUpdateId: string = update.id;
    if (!launchAssetKey || !requestedUpdateId) {
      Log.debug(`Skipping update ${update.id} for pre-warming: no launch asset key`);
      continue;
    }
    Log.debug(
      `Queued update ${update.id} for pre-warming (platform: ${update.platform}, runtime version: ${update.runtimeVersion}, launch asset: ${launchAssetKey})`
    );
    toPrewarm.push({
      update,
      launchAssetKey,
    });
  }

  const warmedDiffsPerUpdate = await Promise.all(
    toPrewarm.map(({ update, launchAssetKey }) =>
      prewarmUpdateDiffsAsync(graphqlClient, appId, update, launchAssetKey)
    )
  );
  return warmedDiffsPerUpdate.flat();
}

// update publish does not currently support web
export type UpdatePublishPlatform = 'ios' | 'android';

export const updatePublishPlatformToAppPlatform: Record<UpdatePublishPlatform, AppPlatform> = {
  android: AppPlatform.Android,
  ios: AppPlatform.Ios,
};

const environmentFlagOverride = 'EAS_UPDATE_SKIP_ENVIRONMENT_CHECK';

const ciEnvironmentFlags = ['EAS_BUILD', 'CI'];

export function environmentFlagNeededForSdk550OrGreater({
  sdkVersion,
  environment,
}: {
  sdkVersion: string | undefined;
  environment: string | undefined;
}): boolean {
  // Skip check if we are in a CI environment
  for (let flag of ciEnvironmentFlags) {
    if (process.env[flag]) {
      return false;
    }
  }
  // Skip check if the env override is set
  if (boolish(environmentFlagOverride, false)) {
    return false;
  }
  if (sdkVersion === undefined || semver.lt(sdkVersion, '55.0.0')) {
    return false;
  }
  return environment === undefined;
}
