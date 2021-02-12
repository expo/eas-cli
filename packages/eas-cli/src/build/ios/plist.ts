import { IOSConfig } from '@expo/config-plugins';
import plist from '@expo/plist';
import fs from 'fs-extra';
import path from 'path';

export async function readPlistAsync(plistPath: string): Promise<object> {
  if (await fs.pathExists(plistPath)) {
    const expoPlistContent = await fs.readFile(plistPath, 'utf8');
    return plist.parse(expoPlistContent);
  } else {
    return {};
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
