import { Errors } from '@oclif/core';

import { UpdatePublishPlatform, updatePublishPlatformToAppPlatform } from './utils';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PublishUpdateGroupInput, UpdateFragment } from '../graphql/generated';
import { UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import { confirmAsync } from '../prompts';

type ActiveRollout = { platform: UpdatePublishPlatform; update: UpdateFragment };

function getPlatformsForUpdateGroup(updateGroup: PublishUpdateGroupInput): UpdatePublishPlatform[] {
  const infoGroup = updateGroup.updateInfoGroup ?? updateGroup.rollBackToEmbeddedInfoGroup;
  return Object.keys(infoGroup ?? {}).filter(
    (platform): platform is UpdatePublishPlatform => platform in updatePublishPlatformToAppPlatform
  );
}

async function findActiveRolloutUpdateAsync(
  graphqlClient: ExpoGraphqlClient,
  {
    appId,
    branchName,
    runtimeVersion,
    platform,
  }: {
    appId: string;
    branchName: string;
    runtimeVersion: string;
    platform: UpdatePublishPlatform;
  }
): Promise<UpdateFragment | null> {
  const latestUpdateGroups = await UpdateQuery.viewUpdateGroupsOnBranchAsync(graphqlClient, {
    appId,
    branchName,
    limit: 1,
    offset: 0,
    filter: {
      runtimeVersions: [runtimeVersion],
      platform: updatePublishPlatformToAppPlatform[platform],
    },
  });
  const latestUpdate = latestUpdateGroups?.[0]?.find(update => update.platform === platform);
  return latestUpdate?.rolloutPercentage != null ? latestUpdate : null;
}

export async function resolveUpdateGroupsSupersedingActiveRolloutsAsync(
  graphqlClient: ExpoGraphqlClient,
  updateGroups: PublishUpdateGroupInput[],
  {
    appId,
    branchName,
    nonInteractive,
    forceEndActiveRollout,
    rolloutPercentage,
  }: {
    appId: string;
    branchName: string;
    nonInteractive: boolean;
    forceEndActiveRollout: boolean;
    rolloutPercentage?: number;
  }
): Promise<PublishUpdateGroupInput[]> {
  const activeRolloutsPerUpdateGroup: ActiveRollout[][] = await Promise.all(
    updateGroups.map(async updateGroup => {
      const maybeActiveRollouts = await Promise.all(
        getPlatformsForUpdateGroup(updateGroup).map(async platform => {
          const update = await findActiveRolloutUpdateAsync(graphqlClient, {
            appId,
            branchName,
            runtimeVersion: updateGroup.runtimeVersion,
            platform,
          });
          return update ? { platform, update } : null;
        })
      );
      return maybeActiveRollouts.filter((rollout): rollout is ActiveRollout => rollout !== null);
    })
  );

  if (activeRolloutsPerUpdateGroup.every(activeRollouts => activeRollouts.length === 0)) {
    return updateGroups;
  }

  for (const [index, activeRollouts] of activeRolloutsPerUpdateGroup.entries()) {
    for (const { platform, update } of activeRollouts) {
      Log.warn(
        `A rollout is in progress on ${platform} for runtime version ${updateGroups[index].runtimeVersion}, currently at ${update.rolloutPercentage}%. Publishing over it ends that rollout.`
      );
    }
  }

  if (!forceEndActiveRollout) {
    const isPartialRollout = rolloutPercentage !== undefined && rolloutPercentage < 100;
    Log.warn(
      isPartialRollout
        ? `Ending a rollout means the update being rolled out is served to the ${100 - rolloutPercentage}% of users not in this new rollout.`
        : 'Ending a rollout means the update being rolled out is served to every user until they receive this new one.'
    );

    if (nonInteractive) {
      throw new Error(
        'Cannot publish over an in-progress rollout in non-interactive mode. Re-run with --force-end-active-rollout to end the rollout and publish anyway.'
      );
    }

    const shouldEndRollout = await confirmAsync({
      message: 'End the rollout and publish anyway?',
      initial: false,
    });
    if (!shouldEndRollout) {
      Errors.error('Aborted.', { exit: 1 });
    }
  }

  return updateGroups.map((updateGroup, index) => {
    const activeRollouts = activeRolloutsPerUpdateGroup[index];
    if (activeRollouts.length === 0) {
      return updateGroup;
    }
    return {
      ...updateGroup,
      previousRolloutUpdateToClobberIdGroup: Object.fromEntries(
        activeRollouts.map(({ platform, update }) => [platform, update.id])
      ),
    };
  });
}
