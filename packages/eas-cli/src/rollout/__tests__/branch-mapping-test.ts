import { v4 as uuidv4 } from 'uuid';

import {
  testChannelObject,
  testUpdateBranch1,
  testUpdateBranch2,
} from '../../channel/__tests__/fixtures';
import {
  BranchMappingOperator,
  alwaysTrue,
  andStatement,
  equalsOperator,
  hashLtOperator,
} from '../../channel/branch-mapping';
import {
  editRolloutBranchMapping,
  getRollout,
  getRolloutInfoFromBranchMapping,
  isConstrainedRollout,
  isConstrainedRolloutInfo,
  isLegacyRolloutInfo,
  isRollout,
} from '../branch-mapping';
import {
  rolloutBranchMapping,
  rolloutBranchMappingLegacy,
  standardBranchMapping,
} from './fixtures';

describe(isLegacyRolloutInfo, () => {
  it('classifies rollouts properly', () => {
    const constrainedRollout = getRolloutInfoFromBranchMapping(rolloutBranchMapping);
    expect(isLegacyRolloutInfo(constrainedRollout)).toBe(false);
    const legacyRollout = getRolloutInfoFromBranchMapping(rolloutBranchMappingLegacy);
    expect(isLegacyRolloutInfo(legacyRollout)).toBe(true);
  });
});

describe(isConstrainedRollout, () => {
  it('classifies rollouts properly', () => {
    const constrainedRollout = getRolloutInfoFromBranchMapping(rolloutBranchMapping);
    expect(isConstrainedRolloutInfo(constrainedRollout)).toBe(true);
    const legacyRollout = getRolloutInfoFromBranchMapping(rolloutBranchMappingLegacy);
    expect(isConstrainedRolloutInfo(legacyRollout)).toBe(false);
  });
});

describe(getRollout, () => {
  it('doesnt get the mapping if it isnt a rollout', () => {
    const notRollout = { ...testChannelObject };
    notRollout.branchMapping = JSON.stringify(standardBranchMapping);
    expect(() => getRollout(notRollout)).toThrowError();
  });
  it('gets a constrained rollout', () => {
    const constrainedRollout = { ...testChannelObject };
    const rolloutBranchMappingWithCorrectBranch = { ...rolloutBranchMapping };
    rolloutBranchMappingWithCorrectBranch.data[0].branchId = testUpdateBranch1.id;
    rolloutBranchMappingWithCorrectBranch.data[1].branchId = testUpdateBranch2.id;
    constrainedRollout.branchMapping = JSON.stringify(rolloutBranchMapping);

    const rollout = getRollout(constrainedRollout);
    expect(rollout.percentRolledOut).toEqual(10);
    expect(isConstrainedRolloutInfo(rollout)).toBe(true);
    expect(rollout.defaultBranch).toEqual(testUpdateBranch2);
    expect(rollout.rolledOutBranch).toEqual(testUpdateBranch1);
    expect(rollout.defaultBranchId).toEqual(testUpdateBranch2.id);
    expect(rollout.rolledOutBranchId).toEqual(testUpdateBranch1.id);
  });
  it('gets a legacy rollout', () => {
    const rollout = getRollout(testChannelObject);
    expect(rollout.percentRolledOut).toEqual(15);
    expect(isLegacyRolloutInfo(rollout)).toBe(true);
    expect(rollout.defaultBranch).toEqual(testUpdateBranch2);
    expect(rollout.rolledOutBranch).toEqual(testUpdateBranch1);
    expect(rollout.defaultBranchId).toEqual(testUpdateBranch2.id);
    expect(rollout.rolledOutBranchId).toEqual(testUpdateBranch1.id);
  });
});

describe(getRolloutInfoFromBranchMapping, () => {
  it('doesnt get the mapping if it isnt a rollout', () => {
    expect(() => getRolloutInfoFromBranchMapping(standardBranchMapping)).toThrowError();
  });
  it('gets a constrained rollout', () => {
    const rollout = getRolloutInfoFromBranchMapping(rolloutBranchMapping);
    expect(rollout.percentRolledOut).toEqual(10);
    expect(isConstrainedRolloutInfo(rollout)).toBe(true);
    expect(rollout.defaultBranchId).toEqual(rolloutBranchMapping.data[1].branchId);
    expect(rollout.rolledOutBranchId).toEqual(rolloutBranchMapping.data[0].branchId);
  });
  it('gets a legacy rollout', () => {
    const rollout = getRolloutInfoFromBranchMapping(rolloutBranchMappingLegacy);
    expect(rollout.percentRolledOut).toEqual(10);
    expect(isLegacyRolloutInfo(rollout)).toBe(true);
    expect(rollout.defaultBranchId).toEqual(rolloutBranchMappingLegacy.data[1].branchId);
    expect(rollout.rolledOutBranchId).toEqual(rolloutBranchMappingLegacy.data[0].branchId);
  });
});

describe(editRolloutBranchMapping, () => {
  it('doesnt edit the branch mapping if it isnt a rollout', () => {
    expect(() => editRolloutBranchMapping(standardBranchMapping, 50)).toThrowError();
  });
  it('doesnt edit the branch mapping if the input is out of range', () => {
    expect(() => editRolloutBranchMapping(standardBranchMapping, -1)).toThrowError();
    expect(() => editRolloutBranchMapping(standardBranchMapping, 101)).toThrowError();
    expect(() => editRolloutBranchMapping(standardBranchMapping, 0.1)).toThrowError();
  });
  it('edits the branch mapping for a constrained rollout', () => {
    const editedBranchMapping = editRolloutBranchMapping(rolloutBranchMapping, 50);
    const rollout = getRolloutInfoFromBranchMapping(editedBranchMapping);
    expect(rollout.percentRolledOut).toEqual(50);
    expect(isConstrainedRolloutInfo(rollout)).toBe(true);
  });
  it('edits the branch mapping for a legacy rollout', () => {
    const editedBranchMapping = editRolloutBranchMapping(rolloutBranchMappingLegacy, 50);
    const rollout = getRolloutInfoFromBranchMapping(editedBranchMapping);
    expect(rollout.percentRolledOut).toEqual(50);
    expect(isLegacyRolloutInfo(rollout)).toBe(true);
  });
});

describe(isRollout, () => {
  it('detects a rollout made by the cli', () => {
    expect(isRollout(rolloutBranchMappingLegacy)).toBe(true);
    expect(isRollout(rolloutBranchMapping)).toBe(true);
  });
  it('detects custom mappings equivalent to rollouts made by the cli', () => {
    const customMapping1 = {
      version: 0,
      data: [
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
        { branchId: uuidv4(), branchMappingLogic: alwaysTrue() },
      ],
    };
    expect(isRollout(customMapping1)).toBe(true);
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

    const customMapping6 = {
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
    expect(isRollout(customMapping6)).toBe(false);
  });
});
