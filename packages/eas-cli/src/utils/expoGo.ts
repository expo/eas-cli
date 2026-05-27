import { getConfigFilePaths } from '@expo/config';
import chalk from 'chalk';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import semver from 'semver';

import { ApiV2Client } from '../api';
import Log from '../log';
import { getPrivateExpoConfigAsync } from '../project/expoConfig';
import { downloadFileWithProgressTrackerAsync, extractArchiveAsync } from './download';
import { formatBytes } from './files';
import { getExpoHomeDirectory } from './paths';

export type ExpoGoPlatform = 'ios' | 'android';

export type SDKVersion = {
  iosClientUrl?: string;
  androidClientUrl?: string;
  iosClientVersion?: string;
  androidClientVersion?: string;
  beta?: boolean;
  [key: string]: unknown;
};

export type ExpoVersions = {
  sdkVersions: Record<string, SDKVersion>;
};

const SIX_MONTHS_IN_MS = 6 * 30 * 24 * 60 * 60 * 1000;

const platformSettings = {
  ios: {
    versionsKey: 'iosClientUrl',
    extension: 'app',
    getFilePath: (filename: string) =>
      path.join(getExpoHomeDirectory(), 'ios-simulator-app-cache', `${filename}.app`),
  },
  android: {
    versionsKey: 'androidClientUrl',
    extension: 'apk',
    getFilePath: (filename: string) =>
      path.join(getExpoHomeDirectory(), 'android-apk-cache', `${filename}.apk`),
  },
} as const;

function getUrlBasename(url: string): string {
  try {
    return path.basename(new URL(url).pathname);
  } catch {
    return path.basename(url.split('?')[0]);
  }
}

function formatHomePath(filePath: string): string {
  const homeDirectory = os.homedir();
  if (!homeDirectory || !filePath.startsWith(homeDirectory)) {
    return filePath;
  }
  return path.join('~', path.relative(homeDirectory, filePath));
}

export async function detectProjectSdkVersionAsync(
  projectDir: string
): Promise<string | undefined> {
  const paths = getConfigFilePaths(projectDir);
  if (!paths.staticConfigPath && !paths.dynamicConfigPath) {
    return;
  }
  try {
    return (await getPrivateExpoConfigAsync(projectDir)).sdkVersion;
  } catch {
    return;
  }
}

export function normalizeSdkVersion(sdkVersion: string): string {
  if (sdkVersion.toUpperCase() === 'UNVERSIONED') {
    return 'UNVERSIONED';
  } else if (/^\d+$/.test(sdkVersion)) {
    return `${sdkVersion}.0.0`;
  } else if (/^\d+\.\d+$/.test(sdkVersion)) {
    return `${sdkVersion}.0`;
  }
  return sdkVersion;
}

export function isSdkVersionInput(value: string): boolean {
  const normalized = value.toUpperCase();
  return normalized === 'UNVERSIONED' || normalized === 'LATEST' || /^\d+(\.\d+){0,2}$/.test(value);
}

export async function getVersionsAsync(): Promise<ExpoVersions> {
  const response = await new ApiV2Client({
    accessToken: null,
    sessionSecret: null,
  }).getAsync('versions/latest');
  const data = response?.data ?? response;
  if (!data?.sdkVersions) {
    throw new Error('Unexpected response when fetching version info from Expo servers.');
  }
  return data as ExpoVersions;
}

export function getLatestSdkVersion(sdkVersions: Record<string, SDKVersion>): string {
  const latestVersion = Object.keys(sdkVersions)
    .filter(version => semver.valid(version))
    .reduce((latest, version) => (semver.gt(version, latest) ? version : latest), '0.0.0');

  if (latestVersion === '0.0.0') {
    throw new Error('Unable to find a version of Expo Go.');
  }
  return latestVersion;
}

export function getExpoGoVersionEntryFromVersions(
  sdkVersion: string,
  versions: ExpoVersions
): { sdkVersion: string; version: SDKVersion } {
  const normalizedSdkVersion = normalizeSdkVersion(sdkVersion);
  const upperSdkVersion = normalizedSdkVersion.toUpperCase();
  const resolvesToLatest = upperSdkVersion === 'UNVERSIONED' || upperSdkVersion === 'LATEST';
  const resolvedSdkVersion = resolvesToLatest
    ? getLatestSdkVersion(versions.sdkVersions)
    : normalizedSdkVersion;

  if (upperSdkVersion === 'UNVERSIONED') {
    Log.warn(
      `Downloading the latest Expo Go client (${resolvedSdkVersion}). This will not fully conform to UNVERSIONED.`
    );
  }

  const version = versions.sdkVersions[resolvedSdkVersion];
  if (!version) {
    throw new Error(`Unable to find a version of Expo Go for SDK ${normalizedSdkVersion}`);
  }
  return { sdkVersion: resolvedSdkVersion, version };
}

export async function getExpoGoVersionEntryAsync(
  sdkVersion: string
): Promise<{ sdkVersion: string; version: SDKVersion }> {
  return getExpoGoVersionEntryFromVersions(sdkVersion, await getVersionsAsync());
}

export async function getExpoGoDownloadUrlAsync(
  platform: ExpoGoPlatform,
  {
    projectDir = process.cwd(),
    sdkVersion,
  }: {
    projectDir?: string;
    sdkVersion?: string;
  } = {}
): Promise<{ sdkVersion: string; url: string }> {
  const versions = await getVersionsAsync();
  const resolvedSdkVersion = sdkVersion
    ? normalizeSdkVersion(sdkVersion)
    : normalizeSdkVersion(
        (await detectProjectSdkVersionAsync(projectDir)) ??
          getLatestSdkVersion(versions.sdkVersions)
      );
  const { sdkVersion: matchingSdkVersion, version } = getExpoGoVersionEntryFromVersions(
    resolvedSdkVersion,
    versions
  );
  const versionsKey = platformSettings[platform].versionsKey;
  const url = version[versionsKey];
  if (typeof url !== 'string' || !url) {
    throw new Error(
      `Unable to find an Expo Go ${platform} download URL for SDK ${matchingSdkVersion}`
    );
  }
  return { sdkVersion: matchingSdkVersion, url };
}

export async function cleanupOldExpoGoCacheEntriesAsync(
  cacheDirectory: string,
  maxAgeMs: number = SIX_MONTHS_IN_MS
): Promise<void> {
  let cacheEntries: string[];
  try {
    cacheEntries = await fs.readdir(cacheDirectory);
  } catch {
    return;
  }

  const now = Date.now();
  for (const entry of cacheEntries) {
    const filePath = path.join(cacheDirectory, entry);
    try {
      const stat = await fs.lstat(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        Log.debug(`Removing old Expo Go cache entry: ${filePath}`);
        await fs.remove(filePath);
      }
    } catch {
      // Keep cleanup best-effort so a stale entry never blocks a download.
    }
  }
}

export async function downloadExpoGoAsync(
  platform: ExpoGoPlatform,
  {
    projectDir = process.cwd(),
    sdkVersion,
    url,
  }: {
    projectDir?: string;
    sdkVersion?: string;
    url?: string;
  } = {}
): Promise<{ path: string; sdkVersion: string; url: string }> {
  const result = url
    ? { sdkVersion: sdkVersion ? normalizeSdkVersion(sdkVersion) : 'unknown', url }
    : await getExpoGoDownloadUrlAsync(platform, { projectDir, sdkVersion });
  const filename = path.parse(result.url).name;
  const outputPath = platformSettings[platform].getFilePath(filename);

  await cleanupOldExpoGoCacheEntriesAsync(path.dirname(outputPath));
  if (await fs.pathExists(outputPath)) {
    Log.log(`Using cached version from ${chalk.bold(formatHomePath(path.dirname(outputPath)))}`);
    return { ...result, path: outputPath };
  }

  if (platform === 'android') {
    await fs.ensureDir(path.dirname(outputPath));
    await fs.copy(await downloadExpoGoFileToCacheAsync(result.url), outputPath);
  } else {
    await fs.ensureDir(path.dirname(outputPath));
    await fs.remove(outputPath);
    await fs.ensureDir(outputPath);
    await extractArchiveAsync(await downloadExpoGoFileToCacheAsync(result.url), outputPath);
  }

  return { ...result, path: outputPath };
}

async function downloadExpoGoFileToCacheAsync(url: string): Promise<string> {
  const outputPath = path.join(getExpoHomeDirectory(), 'expo-go', getUrlBasename(url));
  if (await fs.pathExists(outputPath)) {
    return outputPath;
  }

  await fs.ensureDir(path.dirname(outputPath));
  await downloadFileWithProgressTrackerAsync(
    url,
    outputPath,
    (ratio, total) => `Downloading Expo Go (${formatBytes(total * ratio)} / ${formatBytes(total)})`,
    'Successfully downloaded Expo Go',
    { showNewLine: false }
  );
  return outputPath;
}

export async function copyExpoGoToPathAsync({
  destinationPath,
  platform,
  sourcePath,
}: {
  destinationPath?: string;
  platform: ExpoGoPlatform;
  sourcePath: string;
}): Promise<string> {
  const outputPath = await resolveExpoGoOutputPathAsync({
    destinationPath,
    platform,
    sourcePath,
  });

  if (path.resolve(sourcePath) === path.resolve(outputPath)) {
    return outputPath;
  }

  await fs.ensureDir(path.dirname(outputPath));
  await fs.remove(outputPath);
  await fs.copy(sourcePath, outputPath);
  return outputPath;
}

async function resolveExpoGoOutputPathAsync({
  destinationPath,
  platform,
  sourcePath,
}: {
  destinationPath?: string;
  platform: ExpoGoPlatform;
  sourcePath: string;
}): Promise<string> {
  if (!destinationPath) {
    return path.join(process.cwd(), path.basename(sourcePath));
  }

  const resolvedDestinationPath = path.resolve(destinationPath);
  const extension = platformSettings[platform].extension;
  if (resolvedDestinationPath.endsWith(`.${extension}`)) {
    return resolvedDestinationPath;
  }

  const stat = await fs.stat(resolvedDestinationPath).catch(() => null);
  if (!stat || stat.isDirectory()) {
    return path.join(resolvedDestinationPath, path.basename(sourcePath));
  }

  return resolvedDestinationPath;
}
