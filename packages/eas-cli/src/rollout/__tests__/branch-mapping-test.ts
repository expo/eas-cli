import { v4 as uuidv4 } from 'uuid';

import {
  testChannelObject,
  testUpdateBranch1,
  testUpdateBranch2,
} from '../../channel/__tests__/fixtures';
import {
  BranchMappingOperator,
  BranchMappingValidationError,
  alwaysTrue,
  andStatement,
  equalsOperator,
  hashLtOperator,
} from '../../channel/branch-mapping';
import {
  assertRolloutBranchMapping,
  composeRollout,
  createRolloutBranchMapping,
  editRolloutBranchMapping,
  getRollout,
  getRolloutInfo,
  getRolloutInfoFromBranchMapping,
  isConstrainedRollout,
  isConstrainedRolloutInfo,
  isLegacyRolloutInfo,
  isRolloutBranchMapping,
} from '../branch-mapping';
import {
  rolloutBranchMapping,
  rolloutBranchMappingLegacy,
  standardBranchMapping,
} from './fixtures';

describe(composeRollout, () => {
  it('composes a rollout', () => {
    const rollout = getRollout(testChannelObject);
    const rolloutInfo = getRolloutInfo(testChannelObject);
    const composedRollout = composeRollout(rolloutInfo, testUpdateBranch2, testUpdateBranch1);
    expect(composedRollout).toEqual(rollout);
  });
  it('throws if the branches to not match the rollout info', () => {
    const rolloutInfo = getRolloutInfo(testChannelObject);
    expect(() => composeRollout(rolloutInfo, testUpdateBranch1, testUpdateBranch2)).toThrowError(
      BranchMappingValidationError
    );
  });
});

describe(createRolloutBranchMapping, () => {
  it('creates a rollout branch mapping', () => {
    const branchMapping = createRolloutBranchMapping({
      defaultBranchId: 'default-branch-id',
      rolloutBranchId: 'rollout-branch-id',
      percent: 10,
      runtimeVersion: '1.0.0',
    });
    expect(isRolloutBranchMapping(branchMapping)).toBe(true);
  });
  it('throws if an invalid number is passed in', () => {
    expect(() =>
      createRolloutBranchMapping({
        defaultBranchId: 'default-branch-id',
        rolloutBranchId: 'rollout-branch-id',
        percent: 0.1,
        runtimeVersion: '1.0.0',
      })
    ).toThrowError(BranchMappingValidationError);
    expect(() =>
      createRolloutBranchMapping({
        defaultBranchId: 'default-branch-id',
        rolloutBranchId: 'rollout-branch-id',
        percent: -1,
        runtimeVersion: '1.0.0',
      })
    ).toThrowError(BranchMappingValidationError);
    expect(() =>
      createRolloutBranchMapping({
        defaultBranchId: 'default-branch-id',
        rolloutBranchId: 'rollout-branch-id',
        percent: 1000,
        runtimeVersion: '1.0.0',
      })
    ).toThrowError(BranchMappingValidationError);
  });
});

describe(assertRolloutBranchMapping, () => {
  it('asserts a rollout branch mapping', () => {
    expect(() => assertRolloutBranchMapping(standardBranchMapping)).toThrowError(
      BranchMappingValidationError
    );
    expect(() => assertRolloutBranchMapping(rolloutBranchMapping)).not.toThrowError(
      BranchMappingValidationError
    );
    expect(() => assertRolloutBranchMapping(rolloutBranchMappingLegacy)).not.toThrowError(
      BranchMappingValidationError
    );
  });
});

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
  it('doesnt edit the branch mapping if the input is out of range', () => {
    expect(() => editRolloutBranchMapping(rolloutBranchMapping, -1)).toThrowError();
    expect(() => editRolloutBranchMapping(rolloutBranchMapping, 101)).toThrowError();
    expect(() => editRolloutBranchMapping(rolloutBranchMapping, 0.1)).toThrowError();
  });
  it('returns a new instance of a branch mapping', () => {
    const editedBranchMapping = editRolloutBranchMapping(rolloutBranchMapping, 50);
    expect(rolloutBranchMapping).not.toBe(editedBranchMapping);
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

describe(isRolloutBranchMapping, () => {
  it('detects a rollout made by the cli', () => {
    expect(isRolloutBranchMapping(rolloutBranchMappingLegacy)).toBe(true);
    expect(isRolloutBranchMapping(rolloutBranchMapping)).toBe(true);
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
    expect(isRolloutBranchMapping(customMapping1)).toBe(true);
  });
  it('correctly classifies branchMappings that arent rollouts', () => {
    expect(isRolloutBranchMapping(standardBranchMapping)).toBe(false);

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
    expect(isRolloutBranchMapping(customMapping1)).toBe(false);

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
    expect(isRolloutBranchMapping(customMapping2)).toBe(false);

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
    expect(isRolloutBranchMapping(customMapping3)).toBe(false);

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
    expect(isRolloutBranchMapping(customMapping4)).toBe(false);

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
    expect(isRolloutBranchMapping(customMapping5)).toBe(false);

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
    expect(isRolloutBranchMapping(customMapping6)).toBe(false);
  });
});
