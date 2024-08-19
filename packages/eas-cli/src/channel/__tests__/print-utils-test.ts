import { format } from '@expo/timeago.js';

import { testChannelObject, testUpdateBranch1, testUpdateBranch2 } from './fixtures';
import { getAlwaysTrueBranchMapping, getEmptyBranchMapping } from '../branch-mapping';
import { getDescriptionByBranchId } from '../print-utils';

describe(getDescriptionByBranchId, () => {
  it('should get descriptions for multiple branches with multiple update groups', () => {
    const descriptionByBranchId = getDescriptionByBranchId(testChannelObject);
    expect(Object.values(descriptionByBranchId)).toHaveLength(2);
    expect(descriptionByBranchId[testUpdateBranch1.id]).toEqual({
      branch: 'wrong-channel',
      branchRolloutPercentage: 15,
      update: {
        codeSigningKey: undefined,
        group: '16ca6dba-e63b-48b0-baa3-15a894ee9434',
        isRollBackToEmbedded: false,
        message: `"fix bug" (${format('2023-07-17T22:48:59.278Z', 'en_US')} by quintest113)`,
        platforms: 'android, ios',
        runtimeVersion: 'exposdk:48.0.0',
      },
    });

    expect(descriptionByBranchId[testUpdateBranch2.id]).toEqual({
      branch: 'production',
      branchRolloutPercentage: 85,
      update: {
        codeSigningKey: undefined,
        group: 'e40ad156-e9af-4cc2-8e9d-c7b5c328db48',
        isRollBackToEmbedded: false,
        message: `"fix bug" (${format('2023-06-23T23:37:10.004Z', 'en_US')} by quintest113)`,
        platforms: 'android, ios',
        runtimeVersion: 'exposdk:48.0.0',
      },
    });
  });
  it('should get descriptions for branches with no updates', () => {
    const noUpdatesBranch = { ...testUpdateBranch1, updateGroups: [] };
    const oneBranchChannel = {
      ...testChannelObject,
      updateBranches: [noUpdatesBranch],
      branchMapping: JSON.stringify(getAlwaysTrueBranchMapping(noUpdatesBranch.id)),
    };
    const descriptionByBranchId = getDescriptionByBranchId(oneBranchChannel);
    expect(Object.values(descriptionByBranchId)).toHaveLength(1);
    expect(descriptionByBranchId[testUpdateBranch1.id]).toEqual({ branch: 'wrong-channel' });
  });
  it('should get descriptions for no branches', () => {
    const noBranchChannel = {
      ...testChannelObject,
      updateBranches: [],
      branchMapping: JSON.stringify(getEmptyBranchMapping()),
    };
    const descriptionByBranchId = getDescriptionByBranchId(noBranchChannel);
    expect(Object.values(descriptionByBranchId)).toHaveLength(0);
  });
});
