import { ChannelBasicInfo } from './utils';

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

export type BranchMappingDataItem = {
  branchId: string;
  branchMappingLogic: BranchMappingNode;
};

export type BranchMapping = {
  version: number;
  data: BranchMappingDataItem[];
};

export type AlwaysTrueDataItem = {
  branchId: string;
  branchMappingLogic: BranchMappingAlwaysTrue;
};

export type LastItemAlwaysTrueBranchMapping = {
  version: number;
  data: [...BranchMappingDataItem[], AlwaysTrueDataItem];
};

export type EmptyBranchMapping = {
  version: number;
  data: [];
};

export function getEmptyBranchMapping(): EmptyBranchMapping {
  return {
    version: 0,
    data: [],
  };
}

export function getFreshLastItemAlwaysTrueBranchMapping(
  branchId: string
): LastItemAlwaysTrueBranchMapping {
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

export function hasEmptyBranchMap(channelInfo: ChannelBasicInfo): boolean {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  return isEmptyBranchMapping(branchMapping);
}

export function hasRolloutCompatibleBranchMapForRtv(
  channelInfo: ChannelBasicInfo,
  runtimeVersion: string
): boolean {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  return (
    isBranchMappingWithLastItemAlwaysTrue(branchMapping) ||
    isBranchMappingWithRtvConstrainedAlwaysTrue(branchMapping)
  );
}

export function getRolloutCompatibleBranchMapAlwaysTrueBranchId(
  channelInfo: ChannelBasicInfo
): string {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  assertLastItemAlwaysTrueBranchMapping(branchMapping);
  return getAlwaysTrueBranchIdFromLastItemAlwaysTrueMapping(branchMapping);
}

export function isEmptyBranchMapping(
  branchMapping: BranchMapping
): branchMapping is EmptyBranchMapping {
  return branchMapping.data.length === 0;
}

export function isBranchMappingWithLastItemAlwaysTrue(
  branchMapping: BranchMapping
): branchMapping is LastItemAlwaysTrueBranchMapping {
  if (branchMapping.data.length === 0) {
    return false;
  }
  const branchMappingLogic = branchMapping.data[branchMapping.data.length - 1].branchMappingLogic;
  return isAlwaysTrue(branchMappingLogic);
}

export function isBranchMappingWithRtvConstrainedAlwaysTrue(branchMapping: BranchMapping): boolean {
  if (branchMapping.data.length === 0) {
    return false;
  }
}

export function getAlwaysTrueBranchIdFromLastItemAlwaysTrueMapping(
  branchMapping: LastItemAlwaysTrueBranchMapping
): string {
  return branchMapping.data[branchMapping.data.length - 1].branchId;
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

function isVersion(branchMapping: BranchMapping, version: number): boolean {
  return branchMapping.version === version;
}

export function assertVersion(channelInfo: ChannelBasicInfo, version: number): void {
  const branchMapping = getBranchMapping(channelInfo.branchMapping);
  if (!isVersion(branchMapping, version)) {
    throw new BranchMappingValidationError(
      `Expected branch mapping version ${version}. Received: ${JSON.stringify(branchMapping)}`
    );
  }
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

function assertLastItemAlwaysTrueBranchMapping(
  branchMapping: BranchMapping
): asserts branchMapping is LastItemAlwaysTrueBranchMapping {
  if (!isBranchMappingWithLastItemAlwaysTrue(branchMapping)) {
    throw new BranchMappingValidationError(
      'Expected branch mapping with last item always true. Received: ' +
        JSON.stringify(branchMapping)
    );
  }
}

export class BranchMappingValidationError extends Error {}
