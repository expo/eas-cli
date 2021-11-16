import { IOSConfig } from '@expo/config-plugins';
import plist from '@expo/plist';
import fs from 'fs-extra';
import path from 'path';

export async function readPlistAsync(plistPath: string): Promise<object | null> {
  if (await fs.pathExists(plistPath)) {
    const expoPlistContent = await fs.readFile(plistPath, 'utf8');
    try {
      return plist.parse(expoPlistContent);
    } catch (err: any) {
      err.message = `Failed to parse ${plistPath}. ${err.message}`;
      throw err;
    }
  } else {
    return null;
  }
}

export async function writePlistAsync(
  plistPath: string,
  plistObject: IOSConfig.ExpoPlist | IOSConfig.InfoPlist
): Promise<void> {
  const contents = plist.build(plistObject);
  await fs.mkdirp(path.dirname(plistPath));
  await fs.writeFile(plistPath, contents);
}
