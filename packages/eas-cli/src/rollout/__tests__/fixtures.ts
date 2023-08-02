import { v4 as uuidv4 } from 'uuid';

import {
  alwaysTrue,
  andStatement,
  equalsOperator,
  hashLtOperator,
} from '../../channel/branch-mapping';

export const rolloutBranchMapping = {
  version: 0,
  data: [
    {
      branchId: uuidv4(),
      branchMappingLogic: andStatement([
        {
          operand: '1.0.0',
          clientKey: 'runtimeVersion',
          branchMappingOperator: equalsOperator(),
        },
        {
          operand: 10 / 100,
          clientKey: 'rolloutToken',
          branchMappingOperator: hashLtOperator(),
        },
      ]),
    },
    { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
  ],
};

export const rolloutBranchMappingLegacy = {
  version: 0,
  data: [
    {
      branchId: uuidv4(),
      branchMappingLogic: {
        operand: 10 / 100,
        clientKey: 'rolloutToken',
        branchMappingOperator: hashLtOperator(),
      },
    },
    { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
  ],
};

export const standardBranchMapping = {
  version: 0,
  data: [{ branchId: uuidv4(), branchMappingLogic: alwaysTrue() }],
};
