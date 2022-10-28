import { pathExists } from 'fs-extra';
import os from 'os';
import path from 'path';

export const ANDROID_DEFAULT_LOCATION: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: path.join(os.homedir(), 'Library', 'Android', 'sdk'),
  linux: path.join(os.homedir(), 'Android', 'Sdk'),
  win32: path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
};

const defaultLocation = ANDROID_DEFAULT_LOCATION[process.platform];

export async function getAndroidSdkRootAsync(): Promise<string | null> {
  if (process.env.ANDROID_HOME && (await pathExists(process.env.ANDROID_HOME))) {
    return process.env.ANDROID_HOME;
  } else if (process.env.ANDROID_SDK_ROOT && (await pathExists(process.env.ANDROID_SDK_ROOT))) {
    return process.env.ANDROID_SDK_ROOT;
  } else if (defaultLocation && (await pathExists(defaultLocation))) {
    return defaultLocation;
  } else {
    return null;
  }
}
