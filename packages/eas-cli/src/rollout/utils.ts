import {
  BranchMapping,
  BranchMappingNode,
  getNodesFromStatement,
  isAlwaysTrue,
  isAndStatement,
  isStatement,
} from '../channel/branch-mapping';

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
