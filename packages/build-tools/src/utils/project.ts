import spawn, { SpawnOptions, SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'fs-extra';
import path from 'path';

import { PackageManager } from '../utils/packageManager';

/**
 * Check if yarn version is 2 or later (modern yarn) by running `yarn --version`
 */
export async function isUsingModernYarnVersion(projectDir: string): Promise<boolean> {
  const result = await spawn('yarn', ['--version'], { cwd: projectDir, stdio: 'pipe' });
  const version = result.stdout.trim();
  const majorVersion = parseInt(version.split('.')[0], 10);
  return majorVersion >= 2;
}

export function runExpoCliCommand({
  packageManager,
  args,
  options,
}: {
  packageManager: PackageManager;
  args: string[];
  options: SpawnOptions;
}): SpawnPromise<SpawnResult> {
  const argsWithExpo = ['expo', ...args];
  if (packageManager === PackageManager.NPM) {
    return spawn('npx', argsWithExpo, options);
  } else if (packageManager === PackageManager.YARN) {
    return spawn('yarn', argsWithExpo, options);
  } else if (packageManager === PackageManager.PNPM) {
    return spawn('pnpm', argsWithExpo, options);
  } else if (packageManager === PackageManager.BUN) {
    return spawn('bun', argsWithExpo, options);
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
