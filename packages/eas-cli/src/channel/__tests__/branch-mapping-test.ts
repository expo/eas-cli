import { testChannelBasicInfo } from './branch-mapping-fixtures';
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
  getEmptyBranchMapping,
  getStandardBranchId,
  isAlwaysTrueBranchMapping,
  isEmptyBranchMapping,
} from '../branch-mapping';

describe(assertVersion, () => {
  it('throws if the branch mapping is not the correct version', () => {
    expect(() => {
      assertVersion(testChannelBasicInfo, 5);
    }).toThrowError(BranchMappingValidationError);
  });
  it('asserts the correct version', () => {
    assertVersion(testChannelBasicInfo, 0);
    expect(getBranchMapping(testChannelBasicInfo.branchMapping).version).toBe(0);
  });
});

describe(getEmptyBranchMapping, () => {
  it('gets an empty branch mapping', () => {
    expect(isEmptyBranchMapping(getEmptyBranchMapping())).toBe(true);
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
    expect(() => getStandardBranchId(testChannelBasicInfo)).toThrowError(
      BranchMappingValidationError
    );
  });
  it('gets a standard branch id', () => {
    const channelObjectWithStandardMapping = { ...testChannelBasicInfo };
    channelObjectWithStandardMapping.branchMapping = JSON.stringify(standardBranchMapping);
    expect(getStandardBranchId(channelObjectWithStandardMapping)).toBe(
      standardBranchMapping.data[0].branchId
    );
  });
});
