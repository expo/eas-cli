import chalk from 'chalk';

import { assertVersion, hasEmptyBranchMap, hasStandardBranchMap } from './branch-mapping';
import { UpdateChannelObject } from '../graphql/queries/ChannelQuery';
import Log from '../log';
import { getRollout, isRollout } from '../rollout/branch-mapping';
import {
  FormattedBranchDescription,
  formatBranch,
  getUpdateGroupDescriptionsWithBranch,
} from '../update/utils';

/**
 * Log all the branches associated with the channel and their most recent update group
 */
export function logChannelDetails(channel: UpdateChannelObject): void {
  assertVersion(channel, 0);
  const doesSupportMapping =
    hasEmptyBranchMap(channel) || hasStandardBranchMap(channel) || isRollout(channel);
  if (!doesSupportMapping) {
    Log.log(chalk.dim('Custom branch mapping detected.'));
    return;
  }

  const branchDescriptionByBranchId = getDescriptionByBranchId(channel);
  const entries = Object.entries(branchDescriptionByBranchId);
  if (entries.length === 0) {
    Log.log(chalk.dim('No branches are pointed to this channel.'));
  } else {
    Log.log(
      entries
        .map(([_branchId, description]) => formatBranch(description))
        .join(`\n\n${chalk.dim('———')}\n\n`)
    );
  }
}

export function getDescriptionByBranchId(
  channel: UpdateChannelObject
): Record<string, FormattedBranchDescription> {
  return channel.updateBranches.reduce(
    (acc, branch) => {
      const maybeRollout = isRollout(channel) ? getRollout(channel) : null;
      let maybePercentOnBranch: number | undefined = undefined;
      if (maybeRollout) {
        maybePercentOnBranch =
          maybeRollout.rolledOutBranchId === branch.id
            ? maybeRollout.percentRolledOut
            : 100 - maybeRollout.percentRolledOut;
      }

      if (branch.updateGroups.length === 0) {
        acc[branch.id] = { branch: branch.name, branchRolloutPercentage: maybePercentOnBranch };
        return acc;
      }
      const updateGroupsWithBranchDescriptions = getUpdateGroupDescriptionsWithBranch(
        branch.updateGroups
      );
      // display the most recent update group
      const updateGroupWithBranchDescription = updateGroupsWithBranchDescriptions[0];
      const { branch: branchName, ...updateGroup } = updateGroupWithBranchDescription;
      acc[branch.id] = {
        branch: branchName,
        branchRolloutPercentage: maybePercentOnBranch,
        update: updateGroup,
      };
      return acc;
    },
    {} as Record<string, FormattedBranchDescription>
  );
}
