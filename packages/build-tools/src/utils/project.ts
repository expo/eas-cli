import spawn, { SpawnOptions, SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import path from 'path';

import { PackageManager, findPackagerRootDir } from '../utils/packageManager';

/**
 * check if .yarnrc.yml exists in the project dir or in the workspace root dir
 */
export async function isUsingModernYarnVersion(projectDir: string): Promise<boolean> {
  const yarnrcPath = path.join(projectDir, '.yarnrc.yml');
  const yarnrcRootPath = path.join(findPackagerRootDir(projectDir), '.yarnrc.yml');
  return (await fs.pathExists(yarnrcPath)) || (await fs.pathExists(yarnrcRootPath));
}

export function runExpoCliCommand({
  packageManager,
  args,
  options,
}: {
  packageManager: PackageManager;
  args: string[];
  options: Omit<SpawnOptions, 'stdio' | 'logger'> & { logger: bunyan };
}): SpawnPromise<SpawnResult> {
  const normalizedOptions: SpawnOptions = {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const argsWithExpo = ['expo', ...args];
  if (packageManager === PackageManager.NPM) {
    return spawn('npx', argsWithExpo, normalizedOptions);
  } else if (packageManager === PackageManager.YARN) {
    return spawn('yarn', argsWithExpo, normalizedOptions);
  } else if (packageManager === PackageManager.PNPM) {
    return spawn('pnpm', argsWithExpo, normalizedOptions);
  } else if (packageManager === PackageManager.BUN) {
    return spawn('bun', argsWithExpo, normalizedOptions);
  } else {
    throw new Error(`Unsupported package manager: ${packageManager}`);
  }
}

export function readPackageJson(projectDir: string): any {
  const packageJsonPath = path.join(projectDir, 'package.json');
  if (!fs.pathExistsSync(packageJsonPath)) {
    throw new Error(`package.json does not exist in ${projectDir}`);
  }
  try {
    return fs.readJSONSync(packageJsonPath);
  } catch (err: any) {
    throw new Error(`Failed to parse or read package.json: ${err.message}`);
  }
}

export function readEasJsonContents(projectDir: string): string {
  const easJsonPath = path.join(projectDir, 'eas.json');
  if (!fs.pathExistsSync(easJsonPath)) {
    throw new Error(`eas.json does not exist in ${projectDir}.`);
  }

  return fs.readFileSync(easJsonPath, 'utf8');
}
