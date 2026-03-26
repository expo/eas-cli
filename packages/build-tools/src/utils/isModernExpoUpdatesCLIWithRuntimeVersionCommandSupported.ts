import semver from 'semver';

export function isModernExpoUpdatesCLIWithRuntimeVersionCommandSupported(
  expoUpdatesPackageVersion: string
): boolean {
  if (expoUpdatesPackageVersion.includes('canary')) {
    return true;
  }

  // Anything SDK 51 or greater uses the expo-updates CLI
  return semver.gte(expoUpdatesPackageVersion, '0.25.4');
}
