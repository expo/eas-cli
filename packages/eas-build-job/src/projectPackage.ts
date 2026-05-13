import { execFile } from 'child_process';

import { type Env } from './common';

export async function resolveProjectPackageVersionAsync({
  env = process.env,
  packageName,
  projectDir,
}: {
  env?: Env | NodeJS.ProcessEnv;
  packageName: string;
  projectDir: string;
}): Promise<string> {
  const packageJsonSpecifier = `${packageName}/package.json`;
  const expression = `JSON.stringify(require(require.resolve(${JSON.stringify(
    packageJsonSpecifier
  )})).version)`;
  const stdout = await execFileStdoutAsync('node', ['--print', expression], {
    cwd: projectDir,
    env,
  });
  const version = JSON.parse(stdout.trim());
  if (typeof version !== 'string') {
    throw new Error(`Package ${packageName} has an invalid package.json version.`);
  }
  return version;
}

export async function resolveExpoPackageVersionAsync({
  env,
  projectDir,
}: {
  env?: Env | NodeJS.ProcessEnv;
  projectDir: string;
}): Promise<string> {
  return await resolveProjectPackageVersionAsync({
    env,
    packageName: 'expo',
    projectDir,
  });
}

async function execFileStdoutAsync(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Env | NodeJS.ProcessEnv;
  }
): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.toString());
      }
    });
  });
}
