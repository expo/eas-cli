import { IOSConfig } from '@expo/config-plugins';
import fs from 'fs-extra';
import plist from '@expo/plist';

export enum IosMetadataName {
  UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY = 'EXUpdatesRequestHeaders',
  RELEASE_CHANNEL = 'EXUpdatesReleaseChannel',
  RUNTIME_VERSION = 'EXUpdatesRuntimeVersion',
}

export async function iosSetChannelNativelyAsync(
  channel: string,
  workingDirectory: string
): Promise<void> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(workingDirectory);

  if (!(await fs.pathExists(expoPlistPath))) {
    throw new Error(`${expoPlistPath} does not exist`);
  }

  const expoPlistContents = await fs.readFile(expoPlistPath, 'utf8');
  const items: Record<string, string | Record<string, string>> = plist.parse(expoPlistContents);
  items[IosMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY] = {
    ...((items[IosMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY] as Record<
      string,
      string
    >) ?? {}),
    'expo-channel-name': channel,
  };
  const updatedExpoPlistContents = plist.build(items);

  await fs.writeFile(expoPlistPath, updatedExpoPlistContents);
}

export async function iosSetRuntimeVersionNativelyAsync(
  runtimeVersion: string,
  workingDirectory: string
): Promise<void> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(workingDirectory);

  if (!(await fs.pathExists(expoPlistPath))) {
    throw new Error(`${expoPlistPath} does not exist`);
  }

  const expoPlistContents = await fs.readFile(expoPlistPath, 'utf8');
  const items = plist.parse(expoPlistContents);
  items[IosMetadataName.RUNTIME_VERSION] = runtimeVersion;
  const updatedExpoPlistContents = plist.build(items);

  await fs.writeFile(expoPlistPath, updatedExpoPlistContents);
}

export async function iosGetNativelyDefinedChannelAsync(
  workingDirectory: string
): Promise<string | null> {
  const expoPlistPath = IOSConfig.Paths.getExpoPlistPath(workingDirectory);

  if (!(await fs.pathExists(expoPlistPath))) {
    return null;
  }

  const expoPlistContents = await fs.readFile(expoPlistPath, 'utf8');
  try {
    const items: Record<string, string | Record<string, string>> = plist.parse(expoPlistContents);
    const updatesRequestHeaders = (items[
      IosMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY
    ] ?? {}) as Record<string, string>;
    return updatesRequestHeaders['expo-channel-name'] ?? null;
  } catch (err: any) {
    throw new Error(
      `Failed to parse ${IosMetadataName.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY} from Expo.plist: ${err.message}`
    );
  }
}
