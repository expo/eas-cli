export type ChannelBasicInfo = {
  id: string;
  name: string;
  branchMapping: string;
};
export type BranchBasicInfo = {
  id: string;
  name: string;
};

export type UpdateChannelInfoWithBranches<Branch extends BranchBasicInfo> = ChannelBasicInfo & {
  updateBranches: Branch[];
};

function getUpdateBranchNullable<Branch extends BranchBasicInfo>(
  channel: UpdateChannelInfoWithBranches<Branch>,
  branchId: string
): Branch | null {
  const updateBranches = channel.updateBranches;
  const updateBranch = updateBranches.find(branch => branch.id === branchId);
  return updateBranch ?? null;
}

export function getUpdateBranch<Branch extends BranchBasicInfo>(
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
