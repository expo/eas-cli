import { rolloutBranchMapping, standardBranchMapping } from '../../rollout/__tests__/fixtures';
import {
  BranchMappingValidationError,
  getAlwaysTrueBranchMapping,
  getStandardBranchId,
  isAlwaysTrueBranchMapping,
} from '../branch-mapping';
import { testChannelObject } from './fixtures';

describe(isAlwaysTrueBranchMapping, () => {
  it('detects always true branch mappings', () => {
    expect(isAlwaysTrueBranchMapping(standardBranchMapping)).toBe(true);
    expect(isAlwaysTrueBranchMapping(rolloutBranchMapping)).toBe(false);
  });
});

describe(getAlwaysTrueBranchMapping, () => {
  it('gets an always true branch mapping', () => {
    const alwaysTrueBranchMapping = getAlwaysTrueBranchMapping('test-id');
    expect(isAlwaysTrueBranchMapping(alwaysTrueBranchMapping)).toBe(true);
  });
});

describe(getStandardBranchId, () => {
  it('throws if the branch mapping is not a standard mapping', () => {
    expect(() => getStandardBranchId(testChannelObject)).toThrowError(BranchMappingValidationError);
  });
  it('gets a standard branch id', () => {
    const channelObjectWithStandardMapping = { ...testChannelObject };
    channelObjectWithStandardMapping.branchMapping = JSON.stringify(standardBranchMapping);
    expect(getStandardBranchId(channelObjectWithStandardMapping)).toBe(
      standardBranchMapping.data[0].branchId
    );
  });
});
