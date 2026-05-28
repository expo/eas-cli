import { getConfigFilePaths } from '@expo/config';
import chalk from 'chalk';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import semver from 'semver';

import { v4 as uuidv4 } from 'uuid';

import { ApiV2Client } from '../api';
import Log from '../log';
import { getPrivateExpoConfigAsync } from '../project/expoConfig';
import { createCachedFetch } from './cache/createCachedFetch';
import type { FetchLike } from './cache/wrapFetchWithCache';
import { downloadFileWithProgressTrackerAsync, extractArchiveAsync } from './download';
import { formatBytes } from './files';
import { getExpoHomeDirectory, getTmpDirectory } from './paths';

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

// Mirrors @expo/cli's `platformSettings`.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/utils/downloadExpoGoAsync.ts#L18-L31
//
// Adapted for eas-cli:
//   - Adds `extension` for `copyExpoGoToPathAsync` (a feature upstream doesn't have:
//     the `eas go:download` command lets the user pick an output path).
const platformSettings = {
  ios: {
    versionsKey: 'iosClientUrl',
    extension: 'app',
    shouldExtractResults: true,
    getFilePath: (filename: string) =>
      path.join(getExpoHomeDirectory(), 'ios-simulator-app-cache', `${filename}.app`),
  },
  android: {
    versionsKey: 'androidClientUrl',
    extension: 'apk',
    shouldExtractResults: false,
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

// Resolves a single `SDKVersion` entry. Distilled from @expo/cli's
// `getExpoGoVersionEntryAsync` (inline version-map lookup + UNVERSIONED handling).
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/utils/downloadExpoGoAsync.ts#L37-L61
//
// Adapted for eas-cli:
//   - Pure (takes a `versions` map) so the network fetch can be cached separately and
//     the function is trivially testable; upstream fetches inline.
//   - Accepts the literal token `"latest"` in addition to `"UNVERSIONED"`. The
//     `eas go:download <platform> latest <output>` syntax uses it to skip the
//     project-detection / explicit-version path.
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

// Direct port of @expo/cli's `cleanupOldExpoGoCacheEntriesAsync`.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/utils/downloadExpoGoAsync.ts#L63-L90
//
// Adapted for eas-cli:
//   - Uses `fs-extra`'s `lstat`/`remove` instead of `fs.promises.lstat`/`fs.promises.rm`
//     to match eas-cli's existing fs idioms; behaviour is equivalent (recursive remove,
//     mtime-based pruning).
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

// Mirrors @expo/cli's `downloadExpoGoAsync`.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/utils/downloadExpoGoAsync.ts#L92-L160
//
// Adapted for eas-cli:
//   - Accepts an optional `projectDir` + `url` and returns the resolved `sdkVersion`
//     and `url` alongside the cached path. The `eas go:download` and `eas go:url`
//     commands need both pieces of metadata; upstream only returns the path.
//   - Progress is rendered by `downloadFileWithProgressTrackerAsync` (eas-cli's
//     existing ora-based progress tracker) instead of upstream's custom `ProgressBar`.
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

  const { getFilePath, shouldExtractResults } = platformSettings[platform];
  const filename = path.parse(result.url).name;
  const outputPath = getFilePath(filename);

  await cleanupOldExpoGoCacheEntriesAsync(path.dirname(outputPath));
  if (await fs.pathExists(outputPath)) {
    Log.log(`Using cached version from ${chalk.bold(formatHomePath(path.dirname(outputPath)))}`);
    return { ...result, path: outputPath };
  }

  await downloadAppAsync({
    url: result.url,
    outputPath,
    extract: shouldExtractResults,
  });

  return { ...result, path: outputPath };
}

// Mirrors @expo/cli's `downloadAppAsync`.
// Source: https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/utils/downloadAppAsync.ts#L53-L80
//
// Adapted for eas-cli:
//   - Uses `downloadFileWithProgressTrackerAsync` (which wraps eas-cli's
//     proxy/error-aware `fetch`) and threads a cached fetch into it, instead of
//     upstream's `downloadAsync` helper.
//   - Reuses `getTmpDirectory()` (env-paths-based OS temp dir) for the intermediate
//     iOS archive, mirroring upstream's `os.tmpdir()` via `createTempFilePath`.
//   - Defensively removes any stale `outputPath` before iOS extraction so a partial
//     bundle from a previous failed run doesn't get mixed with the new contents.
async function downloadAppAsync({
  url,
  outputPath,
  extract,
}: {
  url: string;
  outputPath: string;
  extract: boolean;
}): Promise<void> {
  const fetchInstance: FetchLike = createCachedFetch({
    // Persist the cached HTTP responses under `~/.expo/expo-go/`. Matches upstream.
    cacheDirectory: 'expo-go',
    // 1 week TTL, mirroring upstream:
    // https://github.com/expo/expo/blob/2c21e2f96ce6aede3d6bb5c780f0964d2116d37b/packages/%40expo/cli/src/api/rest/client.ts#L184
    ttl: 1000 * 60 * 60 * 24 * 7,
  });

  const progressMessage = (ratio: number, total: number): string =>
    `Downloading Expo Go (${formatBytes(total * ratio)} / ${formatBytes(total)})`;

  if (extract) {
    // iOS: download the archive into the OS tmp dir, then extract into the
    // `<name>.app` cache directory. Nothing is persisted under `~/.expo/expo-go`
    // as a raw archive — the only long-lived cache layers are (a) the HTTP
    // response cache (TTL-evicted) and (b) the platform `.app` cache (mtime-evicted).
    const tmpDir = path.join(getTmpDirectory(), uuidv4());
    await fs.ensureDir(tmpDir);
    const tmpPath = path.join(tmpDir, getUrlBasename(url));
    await downloadFileWithProgressTrackerAsync(
      url,
      tmpPath,
      progressMessage,
      'Successfully downloaded Expo Go',
      { showNewLine: false, fetch: fetchInstance }
    );

    await fs.remove(outputPath);
    await fs.ensureDir(outputPath);
    await extractArchiveAsync(tmpPath, outputPath);
  } else {
    // Android: write the .apk straight to its final location in `android-apk-cache/`.
    await fs.ensureDir(path.dirname(outputPath));
    await downloadFileWithProgressTrackerAsync(
      url,
      outputPath,
      progressMessage,
      'Successfully downloaded Expo Go',
      { showNewLine: false, fetch: fetchInstance }
    );
  }
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
