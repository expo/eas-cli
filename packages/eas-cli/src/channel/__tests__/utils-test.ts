import { channelInfoWithBranches, testBasicBranchInfo1 } from './branch-mapping-fixtures';
import { getUpdateBranch } from '../utils';

describe(getUpdateBranch, () => {
  it('gets the update branch', () => {
    expect(getUpdateBranch(channelInfoWithBranches, '754bf17f-efc0-46ab-8a59-a03f20e53e9b')).toBe(
      testBasicBranchInfo1
    );
    expect(() => getUpdateBranch(channelInfoWithBranches, 'not-a-branch-ID')).toThrow();
  });
});
