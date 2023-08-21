import { v4 as uuidv4 } from 'uuid';

import { BranchMapping, alwaysTrue } from '../../channel/branch-mapping';
import { ConstrainedRolloutBranchMapping, LegacyRolloutBranchMapping } from '../branch-mapping';

export const rolloutBranchMapping: ConstrainedRolloutBranchMapping = {
  version: 0,
  data: [
    {
      branchId: uuidv4(),
      branchMappingLogic: [
        'and',
        {
          operand: '1.0.0',
          clientKey: 'runtimeVersion',
          branchMappingOperator: '==',
        },
        {
          operand: 10 / 100,
          clientKey: 'rolloutToken',
          branchMappingOperator: 'hash_lt',
        },
      ],
    },
    { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
  ],
};

export const rolloutBranchMapping2: ConstrainedRolloutBranchMapping = {
  version: 0,
  data: [
    {
      branchId: uuidv4(),
      branchMappingLogic: [
        'and',
        {
          operand: 10 / 100,
          clientKey: 'rolloutToken',
          branchMappingOperator: 'hash_lt',
        },
        {
          operand: '1.0.0',
          clientKey: 'runtimeVersion',
          branchMappingOperator: '==',
        },
      ],
    },
    { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
  ],
};

export const rolloutBranchMappingLegacy: LegacyRolloutBranchMapping = {
  version: 0,
  data: [
    {
      branchId: uuidv4(),
      branchMappingLogic: {
        operand: 10 / 100,
        clientKey: 'rolloutToken',
        branchMappingOperator: 'hash_lt',
      },
    },
    { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
  ],
};

export const standardBranchMapping: BranchMapping = {
  version: 0,
  data: [{ branchId: uuidv4(), branchMappingLogic: alwaysTrue() }],
};

export const emptyBranchMapping: BranchMapping = {
  version: 0,
  data: [],
};
