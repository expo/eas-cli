import assert from 'assert';
import chalk from 'chalk';

import { UpdateChannelObject } from '../graphql/queries/ChannelQuery';
import Log from '../log';
import { getRollout, isRollout } from '../rollout/branch-mapping';
import {
  FormattedBranchDescription,
  formatBranch,
  getUpdateGroupDescriptionsWithBranch,
} from '../update/utils';
import { assertVersion, hasStandardBranchMap } from './branch-mapping';

export function logChannelDetails(channel: UpdateChannelObject): void {
  assertVersion(channel, 0);
  assert(
    hasStandardBranchMap(channel) || isRollout(channel),
    'Only standard branch mappings and rollouts are supported.'
  );

  const branchDescription = channel.updateBranches.flatMap(branch => {
    const updateGroupWithBranchDescriptions = getUpdateGroupDescriptionsWithBranch(
      branch.updateGroups
    );
    const maybeRollout = isRollout(channel) ? getRollout(channel) : null;
    let maybePercentOnBranch: number | undefined = undefined;
    if (maybeRollout) {
      maybePercentOnBranch =
        maybeRollout.rolledOutBranchId === branch.id
          ? maybeRollout.percentRolledOut
          : 100 - maybeRollout.percentRolledOut;
    }

    return updateGroupWithBranchDescriptions.map(
      ({ branch, ...updateGroup }): FormattedBranchDescription => ({
        branch,
        branchRolloutPercentage: maybePercentOnBranch,
        update: updateGroup,
      })
    );
  });

  if (branchDescription.length === 0) {
    Log.log(chalk.dim('No branches are pointed to this channel.'));
  } else {
    Log.log(
      branchDescription
        .map(description => formatBranch(description))
        .join(`\n\n${chalk.dim('———')}\n\n`)
    );
  }
}
