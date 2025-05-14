import { IOSConfig } from '@expo/config-plugins';
import plist from '@expo/plist';
import binaryPlist from 'bplist-parser';
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

const CHAR_CHEVRON_OPEN = 60;
const CHAR_B_LOWER = 98;

export function parseBinaryPlistBuffer(contents: Buffer): any {
  if (contents[0] === CHAR_CHEVRON_OPEN) {
    const info = plist.parse(contents.toString());
    if (Array.isArray(info)) {
      return info[0];
    }
    return info;
  } else if (contents[0] === CHAR_B_LOWER) {
    const info = binaryPlist.parseBuffer(contents);
    if (Array.isArray(info)) {
      return info[0];
    }
    return info;
  } else {
    throw new Error(`Cannot parse plist of type byte (0x${contents[0].toString(16)})`);
  }
}
