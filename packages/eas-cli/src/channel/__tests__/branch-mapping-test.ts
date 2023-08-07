import {
  emptyBranchMapping,
  rolloutBranchMapping,
  standardBranchMapping,
} from '../../rollout/__tests__/fixtures';
import {
  BranchMappingValidationError,
  assertVersion,
  getAlwaysTrueBranchMapping,
  getBranchMapping,
  getStandardBranchId,
  isAlwaysTrueBranchMapping,
  isEmptyBranchMapping,
} from '../branch-mapping';
import { testChannelObject } from './fixtures';

describe(assertVersion, () => {
  it('throws if the branch mapping is not the correct version', () => {
    expect(() => assertVersion(testChannelObject, 5)).toThrowError(BranchMappingValidationError);
  });
  it('asserts the correct version', () => {
    assertVersion(testChannelObject, 0);
    expect(getBranchMapping(testChannelObject.branchMapping).version).toBe(0);
  });
});

describe(isEmptyBranchMapping, () => {
  it('detects empty branch mappings', () => {
    expect(isEmptyBranchMapping(emptyBranchMapping)).toBe(true);
    expect(isEmptyBranchMapping(standardBranchMapping)).toBe(false);
    expect(isEmptyBranchMapping(rolloutBranchMapping)).toBe(false);
  });
});

describe(isAlwaysTrueBranchMapping, () => {
  it('detects always true branch mappings', () => {
    expect(isAlwaysTrueBranchMapping(standardBranchMapping)).toBe(true);
    expect(isAlwaysTrueBranchMapping(rolloutBranchMapping)).toBe(false);
    expect(isAlwaysTrueBranchMapping(emptyBranchMapping)).toBe(false);
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
