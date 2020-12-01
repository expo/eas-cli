import { getConfig } from '@expo/config';
import pkgDir from 'pkg-dir';

import { ensureLoggedInAsync } from '../user/actions';
import { ensureProjectExistsAsync } from './ensureProjectExists';

export async function getProjectAccountNameAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  const user = await ensureLoggedInAsync();
  return exp.owner || user.username;
}

export async function findProjectRootAsync(cwd?: string): Promise<string | null> {
  const projectRootDir = await pkgDir(cwd);
  return projectRootDir ?? null;
}

export async function getProjectIdAsync(projectDir: string): Promise<string> {
  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });
  return await ensureProjectExistsAsync({
    accountName: await getProjectAccountNameAsync(projectDir),
    projectName: exp.slug,
    privacy: exp.privacy,
  });
}
