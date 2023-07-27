import assert from 'assert';

import {
  BranchMapping,
  BranchMappingNode,
  assertNodeObject,
  assertNumber,
  assertStatement,
  assertString,
  getBranchMapping,
  getNodesFromStatement,
  isAlwaysTrue,
  isAndStatement,
  isStatement,
} from '../channel/branch-mapping';
import { getUpdateBranch } from '../channel/utils';
import { UpdateChannelBasicInfoFragment } from '../graphql/generated';
import { UpdateBranchObject, UpdateChannelObject } from '../graphql/queries/ChannelQuery';

export type Rollout = LegacyRollout | ConstrainedRollout;
export type RolloutInfo = LegacyRolloutInfo | ConstrainedRolloutInfo;
type ConstrainedRollout = LegacyRollout & {
  runtimeVersion: string;
};

type LegacyRollout = {
  rolledOutBranch: UpdateBranchObject;
  defaultBranch: UpdateBranchObject;
} & LegacyRolloutInfo;

type ConstrainedRolloutInfo = LegacyRolloutInfo & {
  runtimeVersion: string;
};

type LegacyRolloutInfo = {
  rolledOutBranchId: string;
  percentRolledOut: number;
  defaultBranchId: string;
};

export function isLegacyRolloutInfo(rollout: RolloutInfo): rollout is LegacyRolloutInfo {
  return !isConstrainedRolloutInfo(rollout);
}

export function isConstrainedRolloutInfo(rollout: RolloutInfo): rollout is ConstrainedRolloutInfo {
  return 'runtimeVersion' in rollout;
}

export function isConstrainedRollout(rollout: Rollout): rollout is ConstrainedRollout {
  return isConstrainedRolloutInfo(rollout);
}

export function getRolloutInfo(basicChannelInfo: UpdateChannelBasicInfoFragment): RolloutInfo {
  const branchMapping = getBranchMapping(basicChannelInfo.branchMapping);
  assertRollout(branchMapping);
  return getRolloutInfoFromBranchMapping(branchMapping);
}

export function getRolloutInfoFromBranchMapping(branchMapping: BranchMapping): RolloutInfo {
  assertRollout(branchMapping);
  const rolledOutBranchId = branchMapping.data[0].branchId;
  const defaultBranchId = branchMapping.data[1].branchId;

  if (isRtvConstrainedRollout(branchMapping)) {
    const statementNode = branchMapping.data[0].branchMappingLogic;
    assertStatement(statementNode);
    const nodesFromStatement = getNodesFromStatement(statementNode);

    const runtimeVersionNode = nodesFromStatement.find(isRuntimeVersionNode);
    assert(runtimeVersionNode, 'Runtime version node must be defined.');
    assertNodeObject(runtimeVersionNode);
    const runtimeVersion = runtimeVersionNode.operand;
    assertString(runtimeVersion);

    const rolloutNode = nodesFromStatement.find(isRolloutNode);
    assert(rolloutNode, 'Rollout node must be defined.');
    assertNodeObject(rolloutNode);
    const operand = rolloutNode.operand;
    assertNumber(operand);
    return {
      rolledOutBranchId,
      percentRolledOut: operand * 100,
      runtimeVersion,
      defaultBranchId,
    };
  } else {
    const rolloutNode = branchMapping.data[0].branchMappingLogic;
    assertNodeObject(rolloutNode);
    const operand = rolloutNode.operand;
    assertNumber(operand);
    return {
      rolledOutBranchId,
      percentRolledOut: operand * 100,
      defaultBranchId,
    };
  }
}

export function getRollout(channel: UpdateChannelObject): Rollout {
  const branchMapping = getBranchMapping(channel.branchMapping);
  assertRollout(branchMapping);
  const rolledOutBranchId = branchMapping.data[0].branchId;
  const rolledOutBranch = getUpdateBranch(channel, rolledOutBranchId);
  const defaultBranchId = branchMapping.data[1].branchId;
  const defaultBranch = getUpdateBranch(channel, defaultBranchId);

  const rolloutInfo = getRolloutInfo(channel);
  return {
    ...rolloutInfo,
    rolledOutBranch,
    defaultBranch,
  };
}

/**
 * Detect if a branch mapping is a rollout.
 * 
 * Types of rollout:
 * 1. Legacy unconstrained rollout:
 * Maps to a rollout branch via a rollout token
 * Falls back to a default branch
 * 
 * Example:
 * {
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
  }
  *
  * 2. RTV constrained rollout:
  * Maps to a rollout branch via a rollout token, constrained by runtime version
  * Falls back to a default branch
  * 
  * Example:
  * {
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
  } 
 */
export function isRollout(branchMapping: BranchMapping): boolean {
  return isUnconstrainedRollout(branchMapping) || isRtvConstrainedRollout(branchMapping);
}

export function editRolloutBranchMapping(
  branchMapping: BranchMapping,
  percent: number
): BranchMapping {
  assert(
    Number.isInteger(percent) && percent >= 0 && percent <= 100,
    'The rollout percentage must be an integer between 0 and 100 inclusive.'
  );
  assertRollout(branchMapping);
  if (isRtvConstrainedRollout(branchMapping)) {
    return editRtvConstrainedRollout(branchMapping, percent);
  } else {
    return editLegacyRollout(branchMapping, percent);
  }
}

function editRtvConstrainedRollout(branchMapping: BranchMapping, percent: number): BranchMapping {
  const newBranchMapping = { ...branchMapping };
  const statementNode = newBranchMapping.data[0].branchMappingLogic;
  assertStatement(statementNode);
  const nodesFromStatement = getNodesFromStatement(statementNode);

  const rolloutNode = nodesFromStatement.find(isRolloutNode);
  assert(rolloutNode, 'Rollout node must be defined.');
  assertNodeObject(rolloutNode);
  rolloutNode.operand = percent / 100;
  return newBranchMapping;
}

function editLegacyRollout(branchMapping: BranchMapping, percent: number): BranchMapping {
  const newBranchMapping = { ...branchMapping };
  const rolloutNode = newBranchMapping.data[0].branchMappingLogic;
  assertNodeObject(rolloutNode);
  rolloutNode.operand = percent / 100;
  return newBranchMapping;
}

function assertRollout(branchMapping: BranchMapping): asserts branchMapping is BranchMapping {
  assert(
    isRollout(branchMapping),
    'Branch mapping node must be a rollout. Received: ' + JSON.stringify(branchMapping)
  );
}

function isRtvConstrainedRollout(branchMapping: BranchMapping): boolean {
  if (branchMapping.data.length !== 2) {
    return false;
  }
  const hasRtvRolloutNode = isRtvConstrainedRolloutNode(branchMapping.data[0].branchMappingLogic);
  const defaultsToAlwaysTrueNode = isAlwaysTrue(branchMapping.data[1].branchMappingLogic);

  return hasRtvRolloutNode && defaultsToAlwaysTrueNode;
}

function isRtvConstrainedRolloutNode(node: BranchMappingNode): boolean {
  if (!isStatement(node) || !isAndStatement(node)) {
    return false;
  }

  const statementNodes = getNodesFromStatement(node);
  if (statementNodes.length !== 2) {
    return false;
  }
  const hasRuntimeVersionNode = statementNodes.some(isRuntimeVersionNode);
  const hasRolloutNode = statementNodes.some(isRolloutNode);
  return hasRuntimeVersionNode && hasRolloutNode;
}

function isUnconstrainedRollout(branchMapping: BranchMapping): boolean {
  if (branchMapping.data.length !== 2) {
    return false;
  }
  const hasRolloutNode = isRolloutNode(branchMapping.data[0].branchMappingLogic);
  const defaultsToAlwaysTrueNode = isAlwaysTrue(branchMapping.data[1].branchMappingLogic);
  return hasRolloutNode && defaultsToAlwaysTrueNode;
}

function isRuntimeVersionNode(node: BranchMappingNode): boolean {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return node.clientKey === 'runtimeVersion' && node.branchMappingOperator === '==';
}

function isRolloutNode(node: BranchMappingNode): boolean {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return node.clientKey === 'rolloutToken' && node.branchMappingOperator === 'hash_lt';
}
