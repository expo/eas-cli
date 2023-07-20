import { v4 as uuidv4 } from 'uuid';

import {
  BranchMappingOperator,
  alwaysTrue,
  andStatement,
  equalsOperator,
  hashLtOperator,
} from '../../channel/branch-mapping';
import { isRollout } from '../utils';

const rolloutBranchMapping = {
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

const rolloutBranchMappingLegacy = {
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

const standardBranchMapping = {
  version: 0,
  data: [{ branchId: uuidv4(), branchMappingLogic: alwaysTrue() }],
};

describe(isRollout, () => {
  it('detects a rollout made by the cli', () => {
    expect(isRollout(rolloutBranchMappingLegacy)).toBe(true);
    expect(isRollout(rolloutBranchMapping)).toBe(true);
  });
  it('detects custom mappings equivalent to rollouts made by the cli', () => {
    const customMapping1 = {
      version: 0,
      data: [
        { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
        {
          branchId: uuidv4(),
          branchMappingLogic: {
            operand: 10 / 100,
            clientKey: 'rolloutToken',
            branchMappingOperator: hashLtOperator(),
          },
        },
      ],
    };
    expect(isRollout(customMapping1)).toBe(true);

    const customMapping2 = {
      version: 0,
      data: [
        { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
        {
          branchId: uuidv4(),
          branchMappingLogic: andStatement([
            {
              operand: 10 / 100,
              clientKey: 'rolloutToken',
              branchMappingOperator: hashLtOperator(),
            },
            {
              operand: '1.0.0',
              clientKey: 'runtimeVersion',
              branchMappingOperator: equalsOperator(),
            },
          ]),
        },
      ],
    };
    expect(isRollout(customMapping2)).toBe(true);
  });
  it('correctly classifies branchMappings that arent rollouts', () => {
    expect(isRollout(standardBranchMapping)).toBe(false);

    const customMapping1 = {
      version: 0,
      data: [
        {
          branchId: uuidv4(),
          branchMappingLogic: {
            operand: 10 / 100,
            clientKey: 'rolloutToken',
            branchMappingOperator: 'hash_gt' as BranchMappingOperator,
          },
        },
        { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
      ],
    };
    expect(isRollout(customMapping1)).toBe(false);

    const customMapping2 = {
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
              clientKey: 'FOOBAR',
              branchMappingOperator: hashLtOperator(),
            },
          ]),
        },
        { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
      ],
    };
    expect(isRollout(customMapping2)).toBe(false);

    const customMapping3 = {
      version: 0,
      data: [
        {
          branchId: uuidv4(),
          branchMappingLogic: {
            operand: 10 / 100,
            clientKey: 'FOOBAR',
            branchMappingOperator: hashLtOperator(),
          },
        },
        { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
      ],
    };
    expect(isRollout(customMapping3)).toBe(false);

    const customMapping4 = {
      version: 0,
      data: [
        {
          branchId: uuidv4(),
          branchMappingLogic: {
            operand: 10 / 100,
            clientKey: 'FOOBAR',
            branchMappingOperator: hashLtOperator(),
          },
        },
      ],
    };
    expect(isRollout(customMapping4)).toBe(false);

    const customMapping5 = {
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
            {
              operand: '2.0.0',
              clientKey: 'runtimeVersion',
              branchMappingOperator: equalsOperator(),
            },
          ]),
        },
        { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
      ],
    };
    expect(isRollout(customMapping5)).toBe(false);
  });
});
