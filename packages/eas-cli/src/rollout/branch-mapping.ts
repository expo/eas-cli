import {
  BranchMapping,
  BranchMappingAlwaysTrue,
  BranchMappingNode,
  BranchMappingValidationError,
  alwaysTrue,
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

export type Rollout<Branch extends BranchBasicInfo> =
  | LegacyRollout<Branch>
  | ConstrainedRollout<Branch>;
export type RolloutInfo = LegacyRolloutInfo | ConstrainedRolloutInfo;
type ConstrainedRollout<Branch extends BranchBasicInfo> = LegacyRollout<Branch> & {
  runtimeVersion: string;
};

type LegacyRollout<Branch extends BranchBasicInfo> = {
  rolledOutBranch: Branch;
  defaultBranch: Branch;
} & LegacyRolloutInfo;

type ConstrainedRolloutInfo = LegacyRolloutInfo & {
  runtimeVersion: string;
};

type LegacyRolloutInfo = {
  rolledOutBranchId: string;
  percentRolledOut: number;
  defaultBranchId: string;
};

export type RolloutBranchMapping = LegacyRolloutBranchMapping | ConstrainedRolloutBranchMapping;

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

export type ConstrainedRolloutBranchMapping = {
  version: number;
  data: [
    {
      branchId: string;
      branchMappingLogic: RtvConstrainedRolloutNode;
    },
    {
      branchId: string;
      branchMappingLogic: BranchMappingAlwaysTrue;
    },
  ];
};

export function isLegacyRolloutInfo(rollout: RolloutInfo): rollout is LegacyRolloutInfo {
  return !isConstrainedRolloutInfo(rollout);
}

export function isConstrainedRolloutInfo(rollout: RolloutInfo): rollout is ConstrainedRolloutInfo {
  return 'runtimeVersion' in rollout;
}

export function isConstrainedRollout<Branch extends BranchBasicInfo>(
  rollout: Rollout<Branch>
): rollout is ConstrainedRollout<Branch> {
  return isConstrainedRolloutInfo(rollout);
}

export function getRolloutInfo(basicChannelInfo: ChannelBasicInfo): RolloutInfo {
  const rolloutBranchMapping = getRolloutBranchMapping(basicChannelInfo.branchMapping);
  return getRolloutInfoFromBranchMapping(rolloutBranchMapping);
}

export function getRolloutInfoFromBranchMapping(branchMapping: RolloutBranchMapping): RolloutInfo {
  const rolledOutBranchId = branchMapping.data[0].branchId;
  const defaultBranchId = branchMapping.data[1].branchId;

  if (isRtvConstrainedRollout(branchMapping)) {
    const statementNode = branchMapping.data[0].branchMappingLogic;
    assertStatement(statementNode);
    const nodesFromStatement = getNodesFromStatement(statementNode);

    const runtimeVersionNode = nodesFromStatement.find(isRuntimeVersionNode);
    if (!runtimeVersionNode) {
      throw new BranchMappingValidationError('Runtime version node must be defined.');
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
  } else {
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
}

export function getRollout<Branch extends BranchBasicInfo>(
  channel: UpdateChannelInfoWithBranches<Branch>
): Rollout<Branch> {
  const rolloutBranchMapping = getRolloutBranchMapping(channel.branchMapping);
  const rolledOutBranchId = rolloutBranchMapping.data[0].branchId;
  const rolledOutBranch = getUpdateBranch(channel, rolledOutBranchId);
  const defaultBranchId = rolloutBranchMapping.data[1].branchId;
  const defaultBranch = getUpdateBranch(channel, defaultBranchId);
  const rolloutInfo = getRolloutInfo(channel);
  return composeRollout<Branch>(rolloutInfo, defaultBranch, rolledOutBranch);
}

export function composeRollout<Branch extends BranchBasicInfo>(
  rolloutInfo: RolloutInfo,
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

export function getRolloutBranchMapping(branchMappingString: string): RolloutBranchMapping {
  const branchMapping = getBranchMapping(branchMappingString);
  assertRolloutBranchMapping(branchMapping);
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
export function isRolloutBranchMapping(
  branchMapping: BranchMapping
): branchMapping is RolloutBranchMapping {
  return isUnconstrainedRollout(branchMapping) || isRtvConstrainedRollout(branchMapping);
}

export function isRollout(channelInfo: ChannelBasicInfo): boolean {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  return isRolloutBranchMapping(branchMapping);
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

export function createRolloutBranchMapping({
  defaultBranchId,
  rolloutBranchId,
  percent,
  runtimeVersion,
}: {
  defaultBranchId: string;
  rolloutBranchId: string;
  percent: number;
  runtimeVersion: string;
}): ConstrainedRolloutBranchMapping {
  assertPercent(percent);
  return {
    version: 0,
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
      { branchId: defaultBranchId, branchMappingLogic: alwaysTrue() },
    ],
  };
}

export function editRolloutBranchMapping(
  branchMapping: RolloutBranchMapping,
  percent: number
): RolloutBranchMapping {
  assertPercent(percent);
  if (isRtvConstrainedRollout(branchMapping)) {
    return editRtvConstrainedRollout(branchMapping, percent);
  } else {
    return editLegacyRollout(branchMapping, percent);
  }
}

function editRtvConstrainedRollout(
  branchMapping: ConstrainedRolloutBranchMapping,
  percent: number
): ConstrainedRolloutBranchMapping {
  const newBranchMapping = { ...branchMapping };
  const statementNode = newBranchMapping.data[0].branchMappingLogic;
  const nodesFromStatement = getNodesFromStatement(statementNode);

  const rolloutNode = nodesFromStatement.find(isRolloutNode);
  if (!rolloutNode) {
    throw new BranchMappingValidationError('Rollout node must be defined.');
  }
  rolloutNode.operand = percent / 100;
  return newBranchMapping;
}

function editLegacyRollout(
  branchMapping: LegacyRolloutBranchMapping,
  percent: number
): LegacyRolloutBranchMapping {
  const newBranchMapping = { ...branchMapping };
  const rolloutNode = newBranchMapping.data[0].branchMappingLogic;
  rolloutNode.operand = percent / 100;
  return newBranchMapping;
}

function isRtvConstrainedRollout(
  branchMapping: BranchMapping
): branchMapping is ConstrainedRolloutBranchMapping {
  if (branchMapping.data.length !== 2) {
    return false;
  }
  const hasRtvRolloutNode = isRtvConstrainedRolloutNode(branchMapping.data[0].branchMappingLogic);
  const defaultsToAlwaysTrueNode = isAlwaysTrue(branchMapping.data[1].branchMappingLogic);
  return hasRtvRolloutNode && defaultsToAlwaysTrueNode;
}

function isRtvConstrainedRolloutNode(node: BranchMappingNode): node is RtvConstrainedRolloutNode {
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

function isUnconstrainedRollout(
  branchMapping: BranchMapping
): branchMapping is LegacyRolloutBranchMapping {
  if (branchMapping.data.length !== 2) {
    return false;
  }
  const hasRolloutNode = isRolloutNode(branchMapping.data[0].branchMappingLogic);
  const defaultsToAlwaysTrueNode = isAlwaysTrue(branchMapping.data[1].branchMappingLogic);
  return hasRolloutNode && defaultsToAlwaysTrueNode;
}

function isRuntimeVersionNode(node: BranchMappingNode): node is RuntimeVersionNode {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return node.clientKey === 'runtimeVersion' && node.branchMappingOperator === '==';
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

export function assertRolloutBranchMapping(
  branchMapping: BranchMapping
): asserts branchMapping is RolloutBranchMapping {
  if (!isRolloutBranchMapping(branchMapping)) {
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
