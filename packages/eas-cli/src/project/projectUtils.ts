import { getConfig } from '@expo/config';
import assert from 'assert';
import pkgDir from 'pkg-dir';

import { getUserAsync } from '../user/User';

export async function getProjectAccountNameAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  const user = await getUserAsync();
  assert(user, 'You need to be logged in');
  return exp.owner || user.username;
}

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);
  return projectRootDir ?? null;
}
