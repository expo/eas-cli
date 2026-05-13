import spawn from '@expo/turtle-spawn';

import { type Env } from './common';

export async function getInstalledExpoPackageVersionAsync({
  env = process.env,
  projectDir,
}: {
  env?: Env | NodeJS.ProcessEnv;
  projectDir: string;
}): Promise<string> {
  const expression = `JSON.stringify(require(require.resolve('expo/package.json')).version)`;
  const { stdout } = await spawn('node', ['--print', expression], {
    cwd: projectDir,
    env,
    stdio: 'pipe',
  });
  const version = JSON.parse(stdout.toString().trim());
  if (typeof version !== 'string') {
    throw new Error('Package expo has an invalid package.json version.');
  }
  return version;
}
