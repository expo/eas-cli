import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import resolveFrom from 'resolve-from';

export default async function getExpoUpdatesPackageVersionIfInstalledAsync(
  reactNativeProjectDirectory: string,
  logger: bunyan
): Promise<string | null> {
  const maybePackageJson = resolveFrom.silent(
    reactNativeProjectDirectory,
    'expo-updates/package.json'
  );

  let versionOuter: string | null = null;
  if (maybePackageJson) {
    const { version } = await fs.readJson(maybePackageJson);
    versionOuter = version;
  }

  logger.debug(`Resolved expo-updates package version: ${versionOuter}`);
  return versionOuter;
}
