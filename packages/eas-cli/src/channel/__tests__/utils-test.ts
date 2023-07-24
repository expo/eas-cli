import { getUpdateBranch } from '../utils';
import { testChannelObject, testUpdateBranch1 } from './fixtures';

describe(getUpdateBranch, () => {
  it('gets the update branch', () => {
    expect(getUpdateBranch(testChannelObject, '754bf17f-efc0-46ab-8a59-a03f20e53e9b')).toBe(
      testUpdateBranch1
    );
    expect(() => getUpdateBranch(testChannelObject, 'not-a-branch-ID')).toThrow();
  });
});
