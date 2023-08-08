import {
  UpdateBranchBasicInfoFragment,
  UpdateChannelBasicInfoFragment,
} from '../graphql/generated';

export type UpdateChannelInfoWithBranches<Branch extends UpdateBranchBasicInfoFragment> =
  UpdateChannelBasicInfoFragment & {
    updateBranches: Branch[];
  };

function getUpdateBranchNullable<Branch extends UpdateBranchBasicInfoFragment>(
  channel: UpdateChannelInfoWithBranches<Branch>,
  branchId: string
): Branch | null {
  const updateBranches = channel.updateBranches;
  const updateBranch = updateBranches.find(branch => branch.id === branchId);
  return updateBranch ?? null;
}

export function getUpdateBranch<Branch extends UpdateBranchBasicInfoFragment>(
  channel: UpdateChannelInfoWithBranches<Branch>,
  branchId: string
): Branch {
  const updateBranch = getUpdateBranchNullable(channel, branchId);
  if (!updateBranch) {
    throw new Error(
      `Could not find branch with id "${branchId}" in branch-mapping of channel "${channel.name}"`
    );
  }
  return updateBranch;
}
