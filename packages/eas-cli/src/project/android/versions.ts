import assert from 'assert';

const MAX_VERSION_CODE = 2000000000;

export function isValidVersionCode(versionCode: string | number): boolean {
  const numericVersionCode = typeof versionCode === 'string' ? Number(versionCode) : versionCode;
  return Number.isInteger(numericVersionCode) && numericVersionCode <= MAX_VERSION_CODE;
}

export function getNextVersionCode(versionCode: string | number): number {
  assert(isValidVersionCode(versionCode), `Invalid buildNumber ${versionCode}`);
  const numericVersionCode = typeof versionCode === 'string' ? Number(versionCode) : versionCode;
  if (versionCode >= MAX_VERSION_CODE) {
    throw new Error(`2000000000 is max allowed versionCode`);
  }
  return numericVersionCode + 1;
}
