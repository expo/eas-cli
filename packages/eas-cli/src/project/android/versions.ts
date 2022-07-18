import assert from 'assert';

const MAX_VERSION_CODE = 2000000000;
export const INVALID_VERSION_CODE_ERROR_MESSAGE = `Invalid value, versionCode needs to be an positive integer smaller or equal ${MAX_VERSION_CODE}`;

export function isValidVersionCode(versionCode: string | number): boolean {
  const numericVersionCode = typeof versionCode === 'string' ? Number(versionCode) : versionCode;
  return (
    Number.isInteger(numericVersionCode) &&
    numericVersionCode <= MAX_VERSION_CODE &&
    numericVersionCode > 0
  );
}

export function getNextVersionCode(versionCode: string | number): number {
  assert(isValidVersionCode(versionCode), `Invalid versionCode ${versionCode}`);
  const numericVersionCode = typeof versionCode === 'string' ? Number(versionCode) : versionCode;
  if (numericVersionCode >= MAX_VERSION_CODE) {
    throw new Error(INVALID_VERSION_CODE_ERROR_MESSAGE);
  }
  return numericVersionCode + 1;
}
