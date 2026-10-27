import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = fileURLToPath(new URL('../../..', import.meta.url));

export async function readPackageDirsByNameAsync(): Promise<Map<string, string>> {
  const packagesDir = path.join(ROOT_DIR, 'packages');
  const dirByPackageName = new Map<string, string>();
  for (const dir of await readdir(packagesDir)) {
    const packageJsonPath = path.join(packagesDir, dir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const { name } = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { name: string };
    dirByPackageName.set(name, dir);
  }
  return dirByPackageName;
}
