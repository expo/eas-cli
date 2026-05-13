import { execFile } from 'child_process';

import { type Env } from './common';

export async function getExpoPackageVersionAsync({
  env = process.env,
  projectDir,
}: {
  env?: Env | NodeJS.ProcessEnv;
  projectDir: string;
}): Promise<string> {
  const expression = `JSON.stringify(require(require.resolve('expo/package.json')).version)`;
  const stdout = await execFileStdoutAsync('node', ['--print', expression], {
    cwd: projectDir,
    env,
  });
  const version = JSON.parse(stdout.trim());
  if (typeof version !== 'string') {
    throw new Error('Package expo has an invalid package.json version.');
  }
  return version;
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
