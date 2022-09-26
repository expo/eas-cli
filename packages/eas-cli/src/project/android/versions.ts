import assert from 'assert';

const MAX_VERSION_CODE = 2100000000;
export const VERSION_CODE_REQUIREMENTS = `versionCode needs to be a positive integer smaller or equal to ${MAX_VERSION_CODE}`;

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
    throw new Error(`Invalid value: ${VERSION_CODE_REQUIREMENTS}.`);
  }
  return numericVersionCode + 1;
}
