import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { z } from 'zod';

import { commands } from './processes';
import { type PreparedExpoGo } from './preparedExpoGo';
import { type PreinstalledApp } from './state';

const VERSIONS_URL = 'https://api.expo.dev/v2/versions';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'expo-simulator-launcher' };
const VersionsSchema = z.object({
  sdkVersions: z.record(
    z.string(),
    z.object({
      releaseNoteUrl: z.string().optional(),
      isBeta: z.boolean().optional(),
      iosClientUrl: z.string().optional(),
    })
  ),
});

/**
 * Prepares the Expo Go of EXPO_GO_SDK_VERSION, or else the latest stable one, once for every warm
 * device, from the prefetched archive or a download. Claim forbids later installs; started native
 * installs and the shared archive stay owned until claim or stop releases them.
 */
export function startExpoGoPreinstall(
  signal: AbortSignal,
  prepared?: PreparedExpoGo
): {
  claimAsync(selectedUdid: string): Promise<PreinstalledApp | undefined>;
  preinstallOnDeviceAsync(udid: string, boot: Promise<unknown>, signal: AbortSignal): Promise<void>;
  stopAsync(selectedUdid: string): Promise<void>;
} {
  const downloadController = new AbortController();
  const downloadSignal = AbortSignal.any([
    signal,
    downloadController.signal,
    AbortSignal.timeout(120_000),
  ]);
  const directory = fs.mkdtemp(path.join(os.tmpdir(), 'simulator-expo-go-'));
  const installations = new Map<string, Promise<void>>();
  const installed = new Map<string, PreinstalledApp>();
  const operations = new Set<Promise<void>>();
  const failures = new Map<string, unknown>();
  let cleanup: Promise<void> | undefined;
  const archive = (async () => {
    const directoryPath = await directory;
    const { sdk, url } = prepared ?? (await selectExpoGoAsync(downloadSignal));
    // Only prefetch writes the cache. A miss or a bad archive continues with the download.
    const cachedArchivePath = expoGoArchiveCachePath(url);
    const cached = await fs
      .access(cachedArchivePath)
      .then(() => true)
      .catch(() => false);
    if (cached) {
      // A claim or stop during the lookup ends the work, as the download fetch would.
      downloadSignal.throwIfAborted();
      process.stderr.write(`Using the prefetched Expo Go archive for SDK ${sdk}.\n`);
      const appPath = path.join(directoryPath, 'cached', 'ExpoGo.app');
      try {
        await extractCheckedExpoGoAsync(cachedArchivePath, appPath, downloadSignal);
        return { appPath, sdk };
      } catch (error) {
        commands.throwIfCommandCloseTimedOut();
        downloadSignal.throwIfAborted();
        process.stderr.write(`Could not use the prefetched Expo Go archive: ${error}\n`);
      }
    }
    const archivePath = path.join(directoryPath, 'expo-go.tar.gz');
    await downloadExpoGoAsync(url, archivePath, downloadSignal);
    // Wait for the owned extractor to close, including on bad archives and claim/stop.
    const appPath = path.join(directoryPath, 'ExpoGo.app');
    await fs.mkdir(appPath);
    await commands.runAsync('/usr/bin/tar', ['-xzf', archivePath, '-C', appPath]);
    downloadSignal.throwIfAborted();
    await fs.access(path.join(appPath, 'Info.plist'));

    return { appPath, sdk };
  })();
  void archive.catch(() => {});

  async function preinstallAsync(
    target: string,
    boot: Promise<unknown>,
    deviceSignal: AbortSignal
  ): Promise<void> {
    void boot.catch(() => {});
    let installation: Promise<void> | undefined;
    const installSignal = AbortSignal.any([signal, deviceSignal, downloadController.signal]);
    try {
      const { appPath, sdk } = await archive;
      await boot;
      installSignal.throwIfAborted();
      // No await between checking the claim latch and registering the native install.
      process.stderr.write(`Preinstalling Expo Go for SDK ${sdk} on Simulator ${target}.\n`);
      installation = commands.runAsync('xcrun', ['simctl', 'install', target, appPath]).then(
        async () => {
          process.stderr.write('Expo Go preinstall finished.\n');
          const info = await readPreinstalledAppAsync(target, appPath).catch(error => {
            process.stderr.write(`Could not read the preinstalled Expo Go version: ${error}\n`);
            return undefined;
          });
          if (info) {
            installed.set(target, info);
          }
        },
        error => {
          commands.throwIfCommandCloseTimedOut();
          if (error.code === null) {
            throw error;
          }
          process.stderr.write(`Could not preinstall Expo Go on ${target}: ${error}\n`);
        }
      );
      installations.set(target, installation);
      await installation;
    } catch (error) {
      commands.throwIfCommandCloseTimedOut();
      if (installation) {
        throw error;
      }
      if (!installSignal.aborted) {
        process.stderr.write(`Could not preinstall Expo Go on ${target}: ${error}\n`);
      }
    }
  }

  async function cleanUpAsync(): Promise<void> {
    return await (cleanup ??= (async () => {
      // Install failures belong to a device; cleanup still drains every operation.
      await Promise.allSettled([...operations]);
      await archive.catch(() => {});
      // Unproved close never permits temporary-file removal or a stopped acknowledgement.
      commands.throwIfCommandCloseTimedOut();
      await fs.rm(await directory, { recursive: true, force: true });
    })());
  }
  return {
    async preinstallOnDeviceAsync(target, boot, deviceSignal) {
      if (downloadController.signal.aborted || cleanup) {
        return;
      }
      const operation = preinstallAsync(target, boot, deviceSignal).catch(error => {
        failures.set(target, error);
        throw error;
      });
      operations.add(operation);
      await operation;
    },
    async claimAsync(selectedUdid) {
      downloadController.abort();
      void cleanUpAsync().catch(() => {});
      await installations.get(selectedUdid);
      if (failures.has(selectedUdid)) {
        throw failures.get(selectedUdid);
      }
      return installed.get(selectedUdid);
    },
    async stopAsync(selectedUdid) {
      // The session owner must still confirm Simulator shutdown before publishing disabled.
      downloadController.abort();
      await cleanUpAsync();
      commands.throwIfCommandCloseTimedOut();
      if (failures.has(selectedUdid)) {
        throw failures.get(selectedUdid);
      }
    },
  };
}

/**
 * Selects the Expo Go Simulator archive of EXPO_GO_SDK_VERSION, or else of the latest stable SDK.
 * The archive URL must be https.
 */
export async function selectExpoGoAsync(
  signal: AbortSignal
): Promise<{ sdk: string; url: string }> {
  const response = await fetch(VERSIONS_URL, { headers: HEADERS, signal });
  if (!response.ok) {
    throw new Error(`Expo Go versions returned HTTP ${response.status}.`);
  }
  const { sdkVersions } = VersionsSchema.parse(await response.json());
  // A pinned SDK selects its listed release. Otherwise, the same latest stable release policy as
  // expo.dev/go (GoScene/utils.ts).
  const pinned = process.env.EXPO_GO_SDK_VERSION || undefined;
  const sdk = pinned
    ? Object.keys(sdkVersions).find(sdk => sdk === pinned)
    : Object.keys(sdkVersions)
        .filter(sdk => /\b(\d*)\.0\.0/.test(sdk))
        .slice(-10)
        .reverse()
        .find(sdk => sdkVersions[sdk].releaseNoteUrl && !sdkVersions[sdk].isBeta);
  const url = sdk && sdkVersions[sdk].iosClientUrl;
  if (!sdk || !url || new URL(url).protocol !== 'https:') {
    throw new Error(
      pinned
        ? `No Expo Go Simulator archive is available for SDK ${pinned}.`
        : 'No stable Expo Go Simulator archive is available.'
    );
  }
  return { sdk, url };
}

export async function downloadExpoGoAsync(
  url: string,
  archivePath: string,
  signal: AbortSignal
): Promise<void> {
  const archive = await fetch(url, { headers: HEADERS, signal });
  if (!archive.ok || !archive.body) {
    throw new Error(`Expo Go archive returned HTTP ${archive.status}.`);
  }
  await archive.body.pipeTo(Writable.toWeb(createWriteStream(archivePath)), { signal });
  signal.throwIfAborted();
}

/** The directory of the archives that prefetch stores. README: "Prepared files". */
export function expoGoArchiveCacheDirectory(): string {
  return path.join(os.homedir(), 'Library', 'Caches', 'expo-simulator-startup', 'expo-go');
}

/** The archive that prefetch stores for this URL. */
export function expoGoArchiveCachePath(url: string): string {
  const name = `${createHash('sha256').update(url).digest('hex')}.tar.gz`;
  return path.join(expoGoArchiveCacheDirectory(), name);
}

/**
 * Extracts a stored archive. gzip -t runs first because tar accepts some changed bytes.
 * Both commands are owned and get no signal, so callers wait for them to close.
 */
export async function extractCheckedExpoGoAsync(
  archivePath: string,
  appPath: string,
  signal: AbortSignal,
  runAsync: typeof commands.runAsync = commands.runAsync
): Promise<void> {
  await fs.mkdir(appPath, { recursive: true });
  signal.throwIfAborted();
  await runAsync('/usr/bin/gzip', ['-t', archivePath]);
  signal.throwIfAborted();
  await runAsync('/usr/bin/tar', ['-xzf', archivePath, '-C', appPath]);
  signal.throwIfAborted();
  await fs.access(path.join(appPath, 'Info.plist'));
}

async function readPreinstalledAppAsync(udid: string, appPath: string): Promise<PreinstalledApp> {
  const infoPlistPath = path.join(appPath, 'Info.plist');
  const [bundleIdentifier, shortVersion, version] = await Promise.all(
    ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].map(async key =>
      (await commands.runAsync('plutil', ['-extract', key, 'raw', '-o', '-', infoPlistPath])).trim()
    )
  );
  return { udid, bundleIdentifier, shortVersion, version };
}
