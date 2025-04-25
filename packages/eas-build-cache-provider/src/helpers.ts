import { getPackageJson } from '@expo/config';
import { SpawnResult } from '@expo/spawn-async';

type RunOptions = any;

export function isSpawnResultError(obj: any): obj is Error & SpawnResult {
  return (
    obj &&
    'message' in obj &&
    obj.status !== undefined &&
    obj.stdout !== undefined &&
    obj.stderr !== undefined
  );
}

export function isDevClientBuild({
  runOptions,
  projectRoot,
}: {
  runOptions: RunOptions;
  projectRoot: string;
}): boolean {
  if (!hasDirectDevClientDependency(projectRoot)) {
    return false;
  }

  if ('variant' in runOptions && runOptions.variant !== undefined) {
    return runOptions.variant === 'debug';
  }
  if ('configuration' in runOptions && runOptions.configuration !== undefined) {
    return runOptions.configuration === 'Debug';
  }

  return true;
}

export function hasDirectDevClientDependency(projectRoot: string): boolean {
  const { dependencies = {}, devDependencies = {} } = getPackageJson(projectRoot);
  return !!dependencies['expo-dev-client'] || !!devDependencies['expo-dev-client'];
}
