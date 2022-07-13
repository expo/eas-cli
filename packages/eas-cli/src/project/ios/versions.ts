import assert from 'assert';

export function isValidBuildNumber(buildNumber: string): boolean {
  return !!buildNumber.match(/^\d+(\.\d+)*$/);
}

export function getNextBuildNumber(buildNumber: string): string {
  assert(isValidBuildNumber(buildNumber), `Invalid buildNumber ${buildNumber}`);
  const comps = buildNumber.split('.');
  comps[comps.length - 1] = String(Number(comps[comps.length - 1]) + 1);
  return comps.join('.');
}
