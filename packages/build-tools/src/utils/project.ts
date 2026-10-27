import spawn, { SpawnOptions, SpawnPromise, SpawnResult } from '@expo/turtle-spawn';
import fs from 'fs-extra';
import path from 'path';

import { PackageManager, findPackagerRootDir } from '../utils/packageManager';

async function readFirstChars(filePath: string, chars: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const stream = fs.createReadStream(filePath, {
      start: 0,
      end: chars - 1,
    });
    stream.on('error', reject);
    stream.on('data', chunk => {
      chunks.push(chunk as Uint8Array);
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

/**
 * check if .yarnrc.yml exists in the project dir or in the workspace root dir,
 * or if the `yarn.lock` file is classic one, not a modern one
 */
export async function isUsingModernYarnVersion(projectDir: string): Promise<boolean> {
  const rootDir = findPackagerRootDir(projectDir);
  const yarnrcPath = path.join(projectDir, '.yarnrc.yml');
  const yarnrcRootPath = path.join(findPackagerRootDir(projectDir), '.yarnrc.yml');
  if ((await fs.pathExists(yarnrcPath)) || (await fs.pathExists(yarnrcRootPath))) {
    return true;
  }

  const yarnlockPath = path.join(rootDir, 'yarn.lock');
  if (!(await fs.pathExists(yarnlockPath))) {
    return false;
  }

  // The yarn.lock file is for Yarn Classic, not Modern, if it contains "# yarn lockfile v1"
  const startOfLockfile = await readFirstChars(yarnlockPath, 100);
  return !/yarn lockfile v1/i.test(startOfLockfile);
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

export function readAndLogPackageJson(
  logger: { info: (message: string) => void },
  projectDir: string
): any {
  logger.info('Using package.json:');
  const packageJson = readPackageJson(projectDir);
  logger.info(JSON.stringify(packageJson, null, 2));
  return packageJson;
}

export function readEasJsonContents(projectDir: string): string {
  const easJsonPath = path.join(projectDir, 'eas.json');
  if (!fs.pathExistsSync(easJsonPath)) {
    throw new Error(`eas.json does not exist in ${projectDir}.`);
  }

  return fs.readFileSync(easJsonPath, 'utf8');
}
