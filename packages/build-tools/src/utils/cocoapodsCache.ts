import { hashFiles } from '@expo/steps';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as tar from 'tar';

export const COCOAPODS_CACHE_KEY_PREFIX = 'ios-pods-';
export const COCOAPODS_DOWNLOAD_CACHE_KEY_PREFIX = 'ios-pod-downloads-';

const PODS_DIRECTORY_NAME = 'Pods';
const PODFILE_LOCK_NAME = 'Podfile.lock';
const COCOAPODS_DOWNLOAD_CACHE_DIRECTORY_NAME = 'CocoaPods';

export function getCocoapodsCachePaths(workingDirectory: string): {
  iosDirectory: string;
  podsDirectory: string;
  podfileLockPath: string;
} {
  const iosDirectory = path.join(workingDirectory, 'ios');
  return {
    iosDirectory,
    podsDirectory: path.join(iosDirectory, PODS_DIRECTORY_NAME),
    podfileLockPath: path.join(iosDirectory, PODFILE_LOCK_NAME),
  };
}

export function getCocoapodsDownloadCachePath(): string {
  return path.join(os.homedir(), 'Library', 'Caches', COCOAPODS_DOWNLOAD_CACHE_DIRECTORY_NAME);
}

export async function resolveCocoapodsCacheKeyAsync(
  workingDirectory: string,
  cocoapodsVersion: string
): Promise<{ key: string; keyPrefix: string }> {
  const normalizedVersion = cocoapodsVersion.trim();
  if (!normalizedVersion) {
    throw new Error('Failed to determine CocoaPods version');
  }

  const keyPrefix = `${COCOAPODS_CACHE_KEY_PREFIX}${normalizedVersion}-`;
  const { podfileLockPath } = getCocoapodsCachePaths(workingDirectory);

  try {
    await fs.promises.access(podfileLockPath);
  } catch {
    return { key: `${keyPrefix}no-lockfile`, keyPrefix };
  }

  return {
    key: `${keyPrefix}${hashFiles([podfileLockPath])}`,
    keyPrefix,
  };
}

export async function resolveCocoapodsDownloadCacheKeyAsync(
  workingDirectory: string,
  cocoapodsVersion: string
): Promise<{ key: string; keyPrefix: string }> {
  const { key, keyPrefix } = await resolveCocoapodsCacheKeyAsync(
    workingDirectory,
    cocoapodsVersion
  );
  return {
    key: key.replace(COCOAPODS_CACHE_KEY_PREFIX, COCOAPODS_DOWNLOAD_CACHE_KEY_PREFIX),
    keyPrefix: keyPrefix.replace(COCOAPODS_CACHE_KEY_PREFIX, COCOAPODS_DOWNLOAD_CACHE_KEY_PREFIX),
  };
}

export async function compressCocoapodsCacheAsync({
  workingDirectory,
}: {
  workingDirectory: string;
}): Promise<{ archivePath: string }> {
  const { iosDirectory, podsDirectory } = getCocoapodsCachePaths(workingDirectory);
  await fs.promises.access(podsDirectory);

  const archiveDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'save-cocoapods-cache-')
  );
  const archivePath = path.join(archiveDestinationDirectory, 'cache.tar.gz');

  await tar.create(
    {
      file: archivePath,
      cwd: iosDirectory,
      gzip: true,
    },
    [PODS_DIRECTORY_NAME]
  );

  return { archivePath };
}

export async function compressCocoapodsDownloadCacheAsync(): Promise<{ archivePath: string }> {
  const cocoapodsDownloadCachePath = getCocoapodsDownloadCachePath();
  await fs.promises.access(cocoapodsDownloadCachePath);

  const archiveDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'save-cocoapods-download-cache-')
  );
  const archivePath = path.join(archiveDestinationDirectory, 'cache.tar.gz');

  await tar.create(
    {
      file: archivePath,
      cwd: path.dirname(cocoapodsDownloadCachePath),
      gzip: true,
    },
    [COCOAPODS_DOWNLOAD_CACHE_DIRECTORY_NAME]
  );

  return { archivePath };
}

export async function restoreCocoapodsCacheArchiveAsync({
  archivePath,
  workingDirectory,
}: {
  archivePath: string;
  workingDirectory: string;
}): Promise<void> {
  const { iosDirectory, podsDirectory } = getCocoapodsCachePaths(workingDirectory);
  await fs.promises.mkdir(iosDirectory, { recursive: true });

  const temporaryRestoreDirectory = await fs.promises.mkdtemp(
    path.join(iosDirectory, '.eas-pods-cache-')
  );
  try {
    await tar.extract({
      file: archivePath,
      cwd: temporaryRestoreDirectory,
      filter: entryPath =>
        entryPath === PODS_DIRECTORY_NAME || entryPath.startsWith(`${PODS_DIRECTORY_NAME}/`),
    });

    const restoredPodsDirectory = path.join(temporaryRestoreDirectory, PODS_DIRECTORY_NAME);
    const restoredPodsStat = await fs.promises.stat(restoredPodsDirectory);
    if (!restoredPodsStat.isDirectory()) {
      throw new Error('CocoaPods cache archive does not contain a Pods directory');
    }

    await fs.promises.rm(podsDirectory, { recursive: true, force: true });
    await fs.promises.rename(restoredPodsDirectory, podsDirectory);
  } finally {
    await fs.promises.rm(temporaryRestoreDirectory, { recursive: true, force: true });
  }
}

export async function restoreCocoapodsDownloadCacheArchiveAsync({
  archivePath,
}: {
  archivePath: string;
}): Promise<void> {
  const cocoapodsDownloadCachePath = getCocoapodsDownloadCachePath();
  const cachesDirectory = path.dirname(cocoapodsDownloadCachePath);
  await fs.promises.mkdir(cachesDirectory, { recursive: true });

  const temporaryRestoreDirectory = await fs.promises.mkdtemp(
    path.join(cachesDirectory, '.eas-cocoapods-cache-')
  );
  try {
    await tar.extract({
      file: archivePath,
      cwd: temporaryRestoreDirectory,
      filter: entryPath =>
        entryPath === COCOAPODS_DOWNLOAD_CACHE_DIRECTORY_NAME ||
        entryPath.startsWith(`${COCOAPODS_DOWNLOAD_CACHE_DIRECTORY_NAME}/`),
    });

    const restoredCacheDirectory = path.join(
      temporaryRestoreDirectory,
      COCOAPODS_DOWNLOAD_CACHE_DIRECTORY_NAME
    );
    const restoredCacheStat = await fs.promises.stat(restoredCacheDirectory);
    if (!restoredCacheStat.isDirectory()) {
      throw new Error('CocoaPods download cache archive does not contain a CocoaPods directory');
    }

    await fs.promises.rm(cocoapodsDownloadCachePath, { recursive: true, force: true });
    await fs.promises.rename(restoredCacheDirectory, cocoapodsDownloadCachePath);
  } finally {
    await fs.promises.rm(temporaryRestoreDirectory, { recursive: true, force: true });
  }
}
