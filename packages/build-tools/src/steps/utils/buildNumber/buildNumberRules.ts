import { Platform } from '@expo/eas-build-job';

const MAX_ANDROID_VERSION_CODE = 2100000000;

export const BUILD_NUMBER_FORMAT: Record<
  Platform,
  { isValid: (buildNumber: string) => boolean; description: string }
> = {
  [Platform.IOS]: {
    isValid: buildNumber => /^\d+(\.\d+){0,2}$/.test(buildNumber),
    description: 'one to three whole numbers separated by periods',
  },
  [Platform.ANDROID]: {
    isValid: buildNumber =>
      /^\d+$/.test(buildNumber) &&
      Number(buildNumber) > 0 &&
      Number(buildNumber) <= MAX_ANDROID_VERSION_CODE,
    description: `a whole number from 1 to ${MAX_ANDROID_VERSION_CODE}`,
  },
};
const FIRST_BUILD_NUMBER = '1';

export function resolveNextBuildNumber({
  storedBuildNumber,
  projectBuildNumber,
}: {
  storedBuildNumber?: string;
  projectBuildNumber?: string;
}): string {
  if (storedBuildNumber === undefined) {
    return projectBuildNumber === undefined || projectBuildNumber === FIRST_BUILD_NUMBER
      ? FIRST_BUILD_NUMBER
      : incrementBuildNumber(projectBuildNumber);
  }
  return incrementBuildNumber(
    projectBuildNumber !== undefined &&
      compareBuildNumbers(projectBuildNumber, storedBuildNumber) > 0
      ? projectBuildNumber
      : storedBuildNumber
  );
}

function incrementBuildNumber(buildNumber: string): string {
  const components = buildNumber.split('.');
  const lastIndex = components.length - 1;
  components[lastIndex] = String(BigInt(components[lastIndex]) + 1n);
  return components.join('.');
}

function compareBuildNumbers(left: string, right: string): number {
  const leftComponents = left.split('.').map(BigInt);
  const rightComponents = right.split('.').map(BigInt);
  for (let index = 0; index < Math.max(leftComponents.length, rightComponents.length); index++) {
    const difference = (leftComponents[index] ?? 0n) - (rightComponents[index] ?? 0n);
    if (difference !== 0n) {
      return difference > 0n ? 1 : -1;
    }
  }
  return 0;
}
