import { Env } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import path from 'path';
import resolveFrom from 'resolve-from';

const EXPO_TRANSITIVE_DEPENDENCIES_TO_RESOLVE = ['babel-preset-expo', 'expo-asset'];

export async function configureExpoTransitiveDependenciesNodePathAsync({
  projectDir,
  packagerDir,
  env,
  logger,
}: {
  projectDir: string;
  packagerDir: string;
  env: Env;
  logger: bunyan;
}): Promise<void> {
  const projectResolutionRoots = uniqueItems([projectDir, packagerDir]);
  const expoPackageJsonPath = resolvePackageJson(projectResolutionRoots, 'expo');
  if (!expoPackageJsonPath) {
    return;
  }

  const expoResolutionRoots = await getPackageResolutionRootsAsync(expoPackageJsonPath);
  const nodePathEntriesToAdd = new Set<string>();

  for (const packageName of EXPO_TRANSITIVE_DEPENDENCIES_TO_RESOLVE) {
    if (resolvePackageJson(projectResolutionRoots, packageName)) {
      continue;
    }

    const packageJsonPath = resolvePackageJson(expoResolutionRoots, packageName);
    if (!packageJsonPath) {
      continue;
    }

    nodePathEntriesToAdd.add(getNodeModulesDirForPackage(packageJsonPath, packageName));
  }

  if (nodePathEntriesToAdd.size === 0) {
    return;
  }

  const existingNodePathEntries = splitNodePath(env.NODE_PATH);
  const addedNodePathEntries = [...nodePathEntriesToAdd].filter(
    nodePathEntry => !existingNodePathEntries.includes(nodePathEntry)
  );
  if (addedNodePathEntries.length === 0) {
    return;
  }

  env.NODE_PATH = [...existingNodePathEntries, ...addedNodePathEntries].join(path.delimiter);
  logger.info(
    `Extending NODE_PATH with Expo dependency paths: ${addedNodePathEntries.join(path.delimiter)}`
  );
}

function resolvePackageJson(fromDirs: string[], packageName: string): string | null {
  for (const fromDir of fromDirs) {
    const packageJsonPath = resolveFrom.silent(fromDir, `${packageName}/package.json`);
    if (packageJsonPath) {
      return packageJsonPath;
    }
  }
  return null;
}

async function getPackageResolutionRootsAsync(packageJsonPath: string): Promise<string[]> {
  const packageDir = path.dirname(packageJsonPath);
  try {
    return uniqueItems([packageDir, await fs.realpath(packageDir)]);
  } catch {
    return [packageDir];
  }
}

function getNodeModulesDirForPackage(packageJsonPath: string, packageName: string): string {
  const packageDir = path.dirname(packageJsonPath);
  return packageName.startsWith('@')
    ? path.dirname(path.dirname(packageDir))
    : path.dirname(packageDir);
}

function splitNodePath(nodePath: string | undefined): string[] {
  return nodePath?.split(path.delimiter).filter(Boolean) ?? [];
}

function uniqueItems<T>(items: T[]): T[] {
  return [...new Set(items)];
}
