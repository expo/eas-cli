import { getConfig } from '@expo/config';
import pkgDir from 'pkg-dir';

import { ensureLoggedInAsync } from '../user/actions';

export async function getProjectAccountNameAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  const user = await ensureLoggedInAsync();
  return exp.owner || user.username;
}

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);
  return projectRootDir ?? null;
}
