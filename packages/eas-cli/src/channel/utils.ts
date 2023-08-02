import assert from 'assert';
import chalk from 'chalk';

import { UpdateBranchObject, UpdateChannelObject } from '../graphql/queries/ChannelQuery';
import Log from '../log';
import {
  FormattedBranchDescription,
  formatBranch,
  getUpdateGroupDescriptionsWithBranch,
} from '../update/utils';
import { BranchMapping, assertNodeObject, assertNumber, isNodeObject } from './branch-mapping';

/**
 * Get the branch mapping and determine whether it is a rollout.
 * Ensure that the branch mapping is properly formatted.
 */
export function getBranchMapping(branchMappingString?: string): {
  branchMapping: BranchMapping;
  isRollout: boolean;
  rolloutPercent?: number;
} {
  if (!branchMappingString) {
    throw new Error('Missing branch mapping.');
  }
  let branchMapping: BranchMapping;
  try {
    branchMapping = JSON.parse(branchMappingString);
  } catch {
    throw new Error(`Could not parse branchMapping string into a JSON: "${branchMappingString}"`);
  }
  assert(branchMapping, 'Branch Mapping must be defined.');

  if (branchMapping.version !== 0) {
    throw new Error('Branch mapping must be version 0.');
  }

  const isRollout = branchMapping.data.length === 2;
  const branchMappingNode = branchMapping.data[0]?.branchMappingLogic;
  let rolloutPercent: number | undefined;
  if (isNodeObject(branchMappingNode)) {
    assertNumber(branchMappingNode.operand);
    rolloutPercent = branchMappingNode.operand;
  }
  switch (branchMapping.data.length) {
    case 0:
      break;
    case 1:
      if (branchMapping.data[0].branchMappingLogic !== 'true') {
        throw new Error('Branch mapping logic for a single branch must be "true"');
      }
      break;
    case 2:
      assertNodeObject(branchMappingNode);
      if (branchMappingNode.clientKey !== 'rolloutToken') {
        throw new Error('Client key of initial branch mapping must be "rolloutToken"');
      }
      if (branchMappingNode.branchMappingOperator !== 'hash_lt') {
        throw new Error('Branch mapping operator of initial branch mapping must be "hash_lt"');
      }
      if (rolloutPercent == null) {
        throw new Error('Branch mapping is missing a "rolloutPercent"');
      }
      if (branchMapping.data[1].branchMappingLogic !== 'true') {
        throw new Error('Branch mapping logic for a the second branch of a rollout must be "true"');
      }
      break;
    default:
      throw new Error('Branch mapping data must have length less than or equal to 2.');
  }

  return { branchMapping, isRollout, rolloutPercent };
}

export function logChannelDetails(channel: UpdateChannelObject): void {
  const { branchMapping, isRollout, rolloutPercent } = getBranchMapping(channel.branchMapping);
  if (branchMapping.data.length > 2) {
    throw new Error('Branch Mapping data must have length less than or equal to 2.');
  }

  const rolloutBranchIds = branchMapping.data.map(data => data.branchId);
  const branchDescription = channel.updateBranches.flatMap(branch => {
    const updateGroupWithBranchDescriptions = getUpdateGroupDescriptionsWithBranch(
      branch.updateGroups
    );

    const isRolloutBranch = isRollout && rolloutBranchIds.includes(branch.id);
    const isBaseBranch = rolloutBranchIds.length > 0 && rolloutBranchIds[0] === branch.id;
    let rolloutPercentNumber: number | undefined = undefined;
    if (isRolloutBranch) {
      rolloutPercentNumber = isBaseBranch ? rolloutPercent! * 100 : (1 - rolloutPercent!) * 100;
    }

    return updateGroupWithBranchDescriptions.map(
      ({ branch, ...updateGroup }): FormattedBranchDescription => ({
        branch,
        branchRolloutPercentage: rolloutPercentNumber,
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

function getUpdateBranchNullable(
  channel: UpdateChannelObject,
  branchId: string
): UpdateBranchObject | null {
  const updateBranches = channel.updateBranches;
  const updateBranch = updateBranches.find(branch => branch.id === branchId);
  return updateBranch ?? null;
}

export function getUpdateBranch(
  channel: UpdateChannelObject,
  branchId: string
): UpdateBranchObject {
  const updateBranch = getUpdateBranchNullable(channel, branchId);
  if (!updateBranch) {
    throw new Error(
      `Could not find branch with id "${branchId}" in branch-mapping of channel "${channel.name}"`
    );
  }
  return updateBranch;
}
