import { Errors } from '@oclif/core';

import { UpdatePublishPlatform, updatePublishPlatformToAppPlatform } from './utils';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { PublishUpdateGroupInput, UpdateFragment } from '../graphql/generated';
import { UpdateQuery } from '../graphql/queries/UpdateQuery';
import Log from '../log';
import { appPlatformDisplayNames } from '../platform';
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
    if (activeRollouts.length === 0) {
      continue;
    }

    Log.warn(
      `A rollout is in progress for runtime version ${updateGroups[index].runtimeVersion}:`
    );

    const rolloutsByPlatform = activeRollouts
      .map(({ platform, update }) => ({
        platformName: appPlatformDisplayNames[updatePublishPlatformToAppPlatform[platform]],
        percentage: `${update.rolloutPercentage}%`,
        message: update.message,
        group: update.group,
        controlGroup: update.rolloutControlUpdate?.group,
      }))
      .sort((a, b) => a.platformName.localeCompare(b.platformName));
    const platformNameWidth = Math.max(
      ...rolloutsByPlatform.map(({ platformName }) => platformName.length)
    );
    const percentageWidth = Math.max(
      ...rolloutsByPlatform.map(({ percentage }) => percentage.length)
    );

    for (const { platformName, percentage, message, group, controlGroup } of rolloutsByPlatform) {
      const columns = [
        platformName.padEnd(platformNameWidth),
        percentage.padEnd(percentageWidth),
        message ? `"${message}"` : null,
        `group ${group.slice(0, 8)}`,
        controlGroup ? `control ${controlGroup.slice(0, 8)}` : null,
      ].filter(column => column !== null);
      Log.warn(`  • ${columns.join('  ')}`);
    }
  }

  const isPartialRollout = rolloutPercentage !== undefined && rolloutPercentage < 100;
  Log.warn(
    isPartialRollout
      ? `Ending the rollout makes your new update the latest for ${rolloutPercentage}% of users. The other ${100 - rolloutPercentage}% receive the update that was rolling out.`
      : 'Ending the rollout makes your new update the latest, so every user receives it instead. The update that was rolling out stops being served.'
  );
  Log.newLine();

  if (!forceEndActiveRollout) {
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
