import { UpdateChannelBasicInfoFragment } from '../graphql/generated';

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

export type AlwaysTrueBranchMapping = {
  version: number;
  data: [
    {
      branchId: string;
      branchMappingLogic: BranchMappingAlwaysTrue;
    }
  ];
};

export function getAlwaysTrueBranchMapping(branchId: string): AlwaysTrueBranchMapping {
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

export function hasStandardBranchMap(channelInfo: UpdateChannelBasicInfoFragment): boolean {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  return isAlwaysTrueBranchMapping(branchMapping);
}

export function getStandardBranchId(channelInfo: UpdateChannelBasicInfoFragment): string {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  assertAlwaysTrueBranchMapping(branchMapping);
  return getBranchIdFromStandardMapping(branchMapping);
}

export function isAlwaysTrueBranchMapping(
  branchMapping: BranchMapping
): branchMapping is AlwaysTrueBranchMapping {
  const numBranches = branchMapping.data.length;
  if (numBranches !== 1) {
    return false;
  }
  const branchMappingLogic = branchMapping.data[0].branchMappingLogic;
  return isAlwaysTrue(branchMappingLogic);
}

function getBranchIdFromStandardMapping(branchMapping: AlwaysTrueBranchMapping): string {
  return branchMapping.data[0].branchId;
}

export function getBranchIds(branchMapping: BranchMapping): string[] {
  return branchMapping.data.map(data => data.branchId);
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
  if (!isStatement(node)) {
    throw new BranchMappingValidationError(
      'Branch mapping node must be a statement. Received: ' + JSON.stringify(node)
    );
  }
}

export function assertNodeObject(node: BranchMappingNode): asserts node is BranchMappingObject {
  if (!isNodeObject(node)) {
    throw new BranchMappingValidationError(
      'Branch mapping node must be an object. Received: ' + JSON.stringify(node)
    );
  }
}

export function assertNumber(operand: string | number | string[]): asserts operand is number {
  if (typeof operand !== 'number') {
    throw new BranchMappingValidationError(
      'Expected a number. Received: ' + JSON.stringify(operand)
    );
  }
}

export function assertString(operand: string | number | string[]): asserts operand is string {
  if (typeof operand !== 'string') {
    throw new BranchMappingValidationError(
      'Expected a string. Received: ' + JSON.stringify(operand)
    );
  }
}

function assertAlwaysTrueBranchMapping(
  branchMapping: BranchMapping
): asserts branchMapping is AlwaysTrueBranchMapping {
  if (!isAlwaysTrueBranchMapping(branchMapping)) {
    throw new BranchMappingValidationError(
      'Expected standard branch mapping. Received: ' + JSON.stringify(branchMapping)
    );
  }
}

export class BranchMappingValidationError extends Error {}
