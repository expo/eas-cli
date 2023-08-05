import { UpdateBranchObject, UpdateChannelObject } from '../graphql/queries/ChannelQuery';

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
