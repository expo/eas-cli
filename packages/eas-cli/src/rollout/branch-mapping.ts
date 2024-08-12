import {
  BranchMapping,
  BranchMappingAlwaysTrue,
  BranchMappingNode,
  BranchMappingValidationError,
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
import {
  BranchBasicInfo,
  ChannelBasicInfo,
  UpdateChannelInfoWithBranches,
  getUpdateBranch,
} from '../channel/utils';
import { truthy } from '../utils/expodash/filter';

export type Rollout<Branch extends BranchBasicInfo> =
  | LegacyRollout<Branch>
  | ConstrainedRollout<Branch>;
export type RolloutInfo = LegacyRolloutInfo | ConstrainedRolloutInfo[];
type ConstrainedRollout<Branch extends BranchBasicInfo> = LegacyRollout<Branch> & {
  runtimeVersion: string;
};

export type LegacyRollout<Branch extends BranchBasicInfo> = {
  rolledOutBranch: Branch;
  defaultBranch: Branch;
} & LegacyRolloutInfo;

export type ConstrainedRolloutInfo = LegacyRolloutInfo & {
  runtimeVersion: string;
};

export type LegacyRolloutInfo = {
  rolledOutBranchId: string;
  percentRolledOut: number;
  defaultBranchId: string;
};

export type RolloutBranchMapping = LegacyRolloutBranchMapping | BranchMapping;

type RolloutNode = {
  clientKey: 'rolloutToken';
  branchMappingOperator: 'hash_lt';
  operand: number;
};

type RuntimeVersionNode = {
  clientKey: 'runtimeVersion';
  branchMappingOperator: '==';
  operand: string;
};

type RtvConstrainedRolloutNode =
  | ['and', RolloutNode, RuntimeVersionNode]
  | ['and', RuntimeVersionNode, RolloutNode];

export type LegacyRolloutBranchMapping = {
  version: number;
  data: [
    {
      branchId: string;
      branchMappingLogic: RolloutNode;
    },
    {
      branchId: string;
      branchMappingLogic: BranchMappingAlwaysTrue;
    },
  ];
};

export type RtvConstrainedRolloutDataItem = {
  branchId: string;
  branchMappingLogic: RtvConstrainedRolloutNode;
};

export type RtvConstrainedAlwaysTrueDataItem = {
  branchId: string;
  branchMappingLogic: RolloutNode;
};

export function isLegacyRolloutInfo(rolloutInfo: RolloutInfo): rolloutInfo is LegacyRolloutInfo {
  return !Array.isArray(rolloutInfo);
}

export function isConstrainedRolloutInfo(
  rolloutInfo: RolloutInfo
): rolloutInfo is ConstrainedRolloutInfo {
  return Array.isArray(rolloutInfo);
}

export function isConstrainedRollout<Branch extends BranchBasicInfo>(
  rollout: Rollout<Branch>
): rollout is ConstrainedRollout<Branch> {
  return isConstrainedRolloutInfo(rollout);
}

export function getRolloutInfo(basicChannelInfo: ChannelBasicInfo): RolloutInfo {
  return getRolloutInfoFromBranchMapping(getBranchMapping(basicChannelInfo.branchMapping));
}

export function getRolloutInfoFromBranchMapping(branchMapping: BranchMapping): RolloutInfo {
  const defaultBranchId = branchMapping.data[branchMapping.data.length - 1].branchId;

  if (isUnconstrainedRollout(branchMapping)) {
    const rolledOutBranchId = branchMapping.data[0].branchId;
    const rolloutNode = branchMapping.data[0].branchMappingLogic;
    assertNodeObject(rolloutNode);
    const operand = rolloutNode.operand;
    assertNumber(operand);
    return {
      rolledOutBranchId,
      percentRolledOut: Math.round(operand * 100),
      defaultBranchId,
    };
  }

  return branchMapping.data
    .map(dataItem => {
      const rolledOutBranchId = dataItem.branchId;
      const statementNode = dataItem.branchMappingLogic;
      assertStatement(statementNode);
      const nodesFromStatement = getNodesFromStatement(statementNode);
      const runtimeVersionNode = nodesFromStatement.find(isRuntimeVersionNodeForAnyRtv);
      if (!runtimeVersionNode) {
        return null;
      }

      assertNodeObject(runtimeVersionNode);
      const runtimeVersion = runtimeVersionNode.operand;
      assertString(runtimeVersion);

      const rolloutNode = nodesFromStatement.find(isRolloutNode);
      if (!rolloutNode) {
        throw new BranchMappingValidationError('Rollout node must be defined.');
      }
      assertNodeObject(rolloutNode);
      const operand = rolloutNode.operand;
      assertNumber(operand);
      return {
        rolledOutBranchId,
        percentRolledOut: Math.round(operand * 100),
        runtimeVersion,
        defaultBranchId,
      };
    })
    .filter(truthy);
}

export function getLegacyRollout<Branch extends BranchBasicInfo>(
  channel: UpdateChannelInfoWithBranches<Branch>
): LegacyRollout<Branch> {
  const branchMapping = getBranchMapping(channel.branchMapping);
  if (!isUnconstrainedRollout(branchMapping)) {
    throw new Error('Not legacy rollout.');
  }

  const rolloutBranchMapping = branchMapping;
  const rolledOutBranchId = rolloutBranchMapping.data[0].branchId;
  const rolledOutBranch = getUpdateBranch(channel, rolledOutBranchId);
  const defaultBranchId = rolloutBranchMapping.data[1].branchId;
  const defaultBranch = getUpdateBranch(channel, defaultBranchId);
  const rolloutInfo = getRolloutInfo(channel);
  if (!isLegacyRolloutInfo(rolloutInfo)) {
    throw new Error('Not legacy rollout.');
  }
  return composeLegacyRollout<Branch>(rolloutInfo, defaultBranch, rolledOutBranch);
}

export function composeLegacyRollout<Branch extends BranchBasicInfo>(
  rolloutInfo: LegacyRolloutInfo,
  defaultBranch: Branch,
  rolledOutBranch: Branch
): Rollout<Branch> {
  if (rolloutInfo.defaultBranchId !== defaultBranch.id) {
    throw new BranchMappingValidationError(
      `Default branch id must match. Received: ${JSON.stringify(rolloutInfo)} ${defaultBranch.id}`
    );
  }
  if (rolloutInfo.rolledOutBranchId !== rolledOutBranch.id) {
    throw new BranchMappingValidationError(
      `Rolled out branch id must match. Received: ${JSON.stringify(rolloutInfo)} ${
        rolledOutBranch.id
      }`
    );
  }
  return {
    ...rolloutInfo,
    rolledOutBranch,
    defaultBranch,
  };
}

export function getConstrainedRolloutForRtv<Branch extends BranchBasicInfo>(
  channel: UpdateChannelInfoWithBranches<Branch>,
  rtv: string
): ConstrainedRollout<Branch> {
  const branchMapping = getBranchMapping(channel.branchMapping);
  if (!hasRtvConstrainedRolloutForRtv(branchMapping, rtv)) {
    throw new Error('No rollout for runtime version found.');
  }

  const constrainedRolloutDataItemForRtv = branchMapping.data.find(dataItem =>
    isRtvConstrainedRolloutNodeForRtv(dataItem.branchMappingLogic, rtv)
  );
  if (!constrainedRolloutDataItemForRtv) {
    throw new Error('No rollout for runtime version found');
  }

  const rolledOutBranchId = constrainedRolloutDataItemForRtv.branchId;
  const rolledOutBranch = getUpdateBranch(channel, rolledOutBranchId);
  const defaultBranchId = branchMapping.data[branchMapping.data.length - 1].branchId;
  const defaultBranch = getUpdateBranch(channel, defaultBranchId);
  const rolloutInfo = getRolloutInfo(channel);
  if (isLegacyRolloutInfo(rolloutInfo)) {
    throw new Error('Not constrained rollout.');
  }
  const constrainedRolloutInfo = rolloutInfo.find(cri => cri.runtimeVersion === rtv);
  if (!constrainedRolloutInfo) {
    throw new Error('No rollout for runtime version found.');
  }

  return composeConstrainedRollout<Branch>(constrainedRolloutInfo, defaultBranch, rolledOutBranch);
}

export function composeConstrainedRollout<Branch extends BranchBasicInfo>(
  rolloutInfo: ConstrainedRolloutInfo,
  defaultBranch: Branch,
  rolledOutBranch: Branch
): ConstrainedRollout<Branch> {
  if (rolloutInfo.defaultBranchId !== defaultBranch.id) {
    throw new BranchMappingValidationError(
      `Default branch id must match. Received: ${JSON.stringify(rolloutInfo)} ${defaultBranch.id}`
    );
  }
  if (rolloutInfo.rolledOutBranchId !== rolledOutBranch.id) {
    throw new BranchMappingValidationError(
      `Rolled out branch id must match. Received: ${JSON.stringify(rolloutInfo)} ${
        rolledOutBranch.id
      }`
    );
  }
  return {
    ...rolloutInfo,
    rolledOutBranch,
    defaultBranch,
  };
}

export function getRolloutBranchMappingForRtv_DELETE(
  branchMappingString: string,
  rtv: string
): RolloutBranchMapping {
  const branchMapping = getBranchMapping(branchMappingString);
  assertRolloutBranchMappingForRtv(branchMapping, rtv);
  return branchMapping;
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
export function doesBranchMappingHaveRolloutForRtv(
  branchMapping: BranchMapping,
  rtv: string
): branchMapping is RolloutBranchMapping {
  return (
    isUnconstrainedRollout(branchMapping) || hasRtvConstrainedRolloutForRtv(branchMapping, rtv)
  );
}

export function doesChannelHaveRolloutForRtv(channelInfo: ChannelBasicInfo, rtv: string): boolean {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  return doesBranchMappingHaveRolloutForRtv(branchMapping, rtv);
}

export function doesTargetRollout(
  branchMapping: RolloutBranchMapping,
  runtimeVersion: string
): boolean {
  const rolloutInfo = getRolloutInfoFromBranchMapping(branchMapping);
  if (!isConstrainedRolloutInfo(rolloutInfo)) {
    return true;
  }
  return rolloutInfo.runtimeVersion === runtimeVersion;
}

export function insertConstrainedRolloutBranchMappingForRtv(
  existingBranchMapping: BranchMapping,
  {
    rolloutBranchId,
    percent,
    runtimeVersion,
  }: {
    rolloutBranchId: string;
    percent: number;
    runtimeVersion: string;
  }
): BranchMapping {
  assertPercent(percent);
  const updatedBranchMapping: BranchMapping = {
    ...existingBranchMapping,
    data: [
      {
        branchId: rolloutBranchId,
        branchMappingLogic: [
          'and',
          {
            operand: runtimeVersion,
            clientKey: 'runtimeVersion',
            branchMappingOperator: '==',
          },
          {
            operand: percent / 100,
            clientKey: 'rolloutToken',
            branchMappingOperator: 'hash_lt',
          },
        ],
      },
      ...existingBranchMapping.data,
    ],
  };

  if (!hasRtvConstrainedRolloutForRtv(updatedBranchMapping, runtimeVersion)) {
    throw new BranchMappingValidationError('Error creating rollout for runtime version');
  }
  return updatedBranchMapping;
}

export function editRtvConstrainedRolloutForRtv(
  branchMapping: BranchMapping,
  rtv: string,
  percent: number
): BranchMapping {
  const newBranchMapping = { ...branchMapping };
  const statementNodeMatchingRtv = newBranchMapping.data
    .map(d => d.branchMappingLogic)
    .find((node): node is RtvConstrainedRolloutNode =>
      isRtvConstrainedRolloutNodeForRtv(node, rtv)
    );
  if (!statementNodeMatchingRtv) {
    throw new BranchMappingValidationError('No rollout data item matching runtime version found.');
  }
  const nodesFromStatement = getNodesFromStatement(statementNodeMatchingRtv);

  const rolloutNode = nodesFromStatement.find(isRolloutNode);
  if (!rolloutNode) {
    throw new BranchMappingValidationError('Rollout node must be defined.');
  }
  rolloutNode.operand = percent / 100;
  return newBranchMapping;
}

export function editLegacyRollout(
  branchMapping: LegacyRolloutBranchMapping,
  percent: number
): LegacyRolloutBranchMapping {
  const newBranchMapping = { ...branchMapping };
  const rolloutNode = newBranchMapping.data[0].branchMappingLogic;
  rolloutNode.operand = percent / 100;
  return newBranchMapping;
}

function hasRtvConstrainedRolloutForRtv(branchMapping: BranchMapping, rtv: string): boolean {
  const hasRtvRolloutNodeForRtv = branchMapping.data.some(d =>
    isRtvConstrainedRolloutNodeForRtv(d.branchMappingLogic, rtv)
  );
  const lastNodeIsDefaultsToAlwaysTrue = isAlwaysTrue(
    branchMapping.data[branchMapping.data.length - 1].branchMappingLogic
  );
  return hasRtvRolloutNodeForRtv && lastNodeIsDefaultsToAlwaysTrue;
}

function isRtvConstrainedRolloutNodeForRtv(
  node: BranchMappingNode,
  rtv: string
): node is RtvConstrainedRolloutNode {
  if (!isStatement(node) || !isAndStatement(node)) {
    return false;
  }

  const statementNodes = getNodesFromStatement(node);
  if (statementNodes.length !== 2) {
    return false;
  }
  const hasMatchingRuntimeVersionNode = statementNodes.some(sn =>
    isRuntimeVersionNodeForRtv(sn, rtv)
  );
  const hasRolloutNode = statementNodes.some(isRolloutNode);
  return hasMatchingRuntimeVersionNode && hasRolloutNode;
}

export function isUnconstrainedRollout(
  branchMapping: BranchMapping
): branchMapping is LegacyRolloutBranchMapping {
  if (branchMapping.data.length !== 2) {
    return false;
  }
  const hasRolloutNode = isRolloutNode(branchMapping.data[0].branchMappingLogic);
  const defaultsToAlwaysTrueNode = isAlwaysTrue(branchMapping.data[1].branchMappingLogic);
  return hasRolloutNode && defaultsToAlwaysTrueNode;
}

function isRuntimeVersionNodeForAnyRtv(node: BranchMappingNode): node is RuntimeVersionNode {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return (
    node.clientKey === 'runtimeVersion' &&
    node.branchMappingOperator === '==' &&
    typeof node.operand === 'string'
  );
}

function isRuntimeVersionNodeForRtv(
  node: BranchMappingNode,
  rtv: string
): node is RuntimeVersionNode {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return (
    node.clientKey === 'runtimeVersion' &&
    node.branchMappingOperator === '==' &&
    node.operand === rtv
  );
}

function isRolloutNode(node: BranchMappingNode): node is RolloutNode {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return node.clientKey === 'rolloutToken' && node.branchMappingOperator === 'hash_lt';
}

export function assertRolloutBranchMappingForRtv(
  branchMapping: BranchMapping,
  rtv: string
): asserts branchMapping is RolloutBranchMapping {
  if (!doesBranchMappingHaveRolloutForRtv(branchMapping, rtv)) {
    throw new BranchMappingValidationError(
      'Branch mapping node must be a rollout. Received: ' + JSON.stringify(branchMapping)
    );
  }
}

function assertPercent(percent: number): void {
  const isPercent = Number.isInteger(percent) && percent >= 0 && percent <= 100;
  if (!isPercent) {
    throw new BranchMappingValidationError(
      `The percentage must be an integer between 0 and 100 inclusive. Received: ${percent}`
    );
  }
}
