import {
  BranchMapping,
  BranchMappingNode,
  getNodesFromStatement,
  isAlwaysTrue,
  isAndStatement,
  isStatement,
} from '../channel/branch-mapping';

// a rollout made from the cli
export function isRollout(branchMapping: BranchMapping): boolean {
  if (branchMapping.data.length !== 2) {
    return false;
  }
  const hasAlwaysTrueNode = branchMapping.data.some(wrappedNode =>
    isAlwaysTrue(wrappedNode.branchMappingLogic)
  );
  if (!hasAlwaysTrueNode) {
    return false;
  }

  // Legacy rollout
  const hasRolloutNode = branchMapping.data.some(wrappedNode =>
    isRolloutNode(wrappedNode.branchMappingLogic)
  );
  if (hasAlwaysTrueNode && hasRolloutNode) {
    return true;
  }

  const statementNode = branchMapping.data
    .map(wrappedNode => wrappedNode.branchMappingLogic)
    .find(isStatement);
  if (!statementNode) {
    return false;
  }
  if (!isAndStatement(statementNode)) {
    return false;
  }
  const statementNodes = getNodesFromStatement(statementNode);
  const hasRuntimeVersionNode = statementNodes.some(isRuntimeVersionNode);
  const hasRolloutNode2 = statementNodes.some(isRolloutNode);
  return hasRuntimeVersionNode && hasRolloutNode2;
}

export function isRuntimeVersionNode(node: BranchMappingNode): boolean {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return node.clientKey === 'runtimeVersion' && node.branchMappingOperator === '==';
}

export function isRolloutNode(node: BranchMappingNode): boolean {
  if (typeof node === 'string') {
    return false;
  }
  if (Array.isArray(node)) {
    return false;
  }
  return node.clientKey === 'rolloutToken' && node.branchMappingOperator === 'hash_lt';
}
