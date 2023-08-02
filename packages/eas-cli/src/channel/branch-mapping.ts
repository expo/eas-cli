import assert from 'assert';

// TODO(quin): move this into a common package with www
export type BranchMappingOperator =
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'in'
  | 'regex'
  | 'hash_lt'
  | 'hash_lte'
  | 'hash_gt'
  | 'hash_gte';
export type BranchMappingObject = {
  clientKey: string;
  branchMappingOperator: BranchMappingOperator;
  operand: number | string | string[];
};
export type BranchMappingAlwaysTrue = 'true';
export type BranchMappingStatement =
  | ['and' | 'or', ...BranchMappingNode[]]
  | ['not', BranchMappingNode];
export type BranchMappingNode =
  | BranchMappingAlwaysTrue
  | BranchMappingObject
  | BranchMappingStatement;
export type BranchMapping = {
  version: number;
  data: {
    branchId: string;
    branchMappingLogic: BranchMappingNode;
  }[];
};

export function getAlwaysTrueBranchMapping(branchId: string): BranchMapping {
  return {
    version: 0,
    data: [
      {
        branchId,
        branchMappingLogic: 'true',
      },
    ],
  };
}

export function getBranchMapping(branchMappingString: string): BranchMapping {
  try {
    return JSON.parse(branchMappingString);
  } catch {
    throw new Error(`Could not parse branchMapping string into a JSON: "${branchMappingString}"`);
  }
}

export function getNodesFromStatement(statement: BranchMappingStatement): BranchMappingNode[] {
  return statement.slice(1) as BranchMappingNode[];
}

export function isAndStatement(
  statement: BranchMappingStatement
): statement is BranchMappingStatement {
  return statement[0] === 'and';
}

export function isStatement(node: BranchMappingNode): node is BranchMappingStatement {
  return Array.isArray(node);
}

export function isNodeObject(node: BranchMappingNode): node is BranchMappingObject {
  return typeof node === 'object' && !isStatement(node);
}

export function andStatement(nodes: BranchMappingNode[]): ['and', ...BranchMappingNode[]] {
  return ['and', ...nodes];
}

export function isAlwaysTrue(node: BranchMappingNode): boolean {
  return node === 'true';
}

export function alwaysTrue(): BranchMappingAlwaysTrue {
  return 'true';
}

export function equalsOperator(): BranchMappingOperator {
  return '==';
}

export function hashLtOperator(): BranchMappingOperator {
  return 'hash_lt';
}

export function assertStatement(node: BranchMappingNode): asserts node is BranchMappingStatement {
  assert(
    isStatement(node),
    'Branch mapping node must be a statement. Received: ' + JSON.stringify(node)
  );
}

export function assertNodeObject(node: BranchMappingNode): asserts node is BranchMappingObject {
  assert(
    isNodeObject(node),
    'Branch mapping node must be an object. Received: ' + JSON.stringify(node)
  );
}

export function assertNumber(operand: string | number | string[]): asserts operand is number {
  assert(typeof operand === 'number', 'Expected a number. Received: ' + JSON.stringify(operand));
}

export function assertString(operand: string | number | string[]): asserts operand is string {
  assert(typeof operand === 'string', 'Expected a string. Received: ' + JSON.stringify(operand));
}
