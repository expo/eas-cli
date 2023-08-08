import { BranchBasicInfo, ChannelBasicInfo, UpdateChannelInfoWithBranches } from '../utils';

export const testChannelBasicInfo: ChannelBasicInfo = {
  id: '9309afc2-9752-40db-8ef7-4abc10744c61',
  name: 'production',
  branchMapping:
    '{"data":[{"branchId":"754bf17f-efc0-46ab-8a59-a03f20e53e9b","branchMappingLogic":{"operand":0.15,"clientKey":"rolloutToken","branchMappingOperator":"hash_lt"}},{"branchId":"6941a8dd-5c0a-48bc-8876-f49c88ed419f","branchMappingLogic":"true"}],"version":0}',
};

export const testBasicBranchInfo1: BranchBasicInfo = {
  id: '754bf17f-efc0-46ab-8a59-a03f20e53e9b',
  name: 'wrong-channel',
};

export const testBasicBranchInfo2: BranchBasicInfo = {
  id: '6941a8dd-5c0a-48bc-8876-f49c88ed419f',
  name: 'production',
};
export const channelInfoWithBranches: UpdateChannelInfoWithBranches<BranchBasicInfo> = {
  ...testChannelBasicInfo,
  updateBranches: [testBasicBranchInfo1, testBasicBranchInfo2],
};
