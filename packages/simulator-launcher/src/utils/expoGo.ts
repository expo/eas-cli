import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { z } from 'zod';

import { commands } from './processes';
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

/** Claim forbids later installs; started native installs and the shared archive stay owned. */
export function startExpoGoPreinstall(
  udid: string,
  boot: Promise<unknown>,
  signal: AbortSignal,
  reuseArchive = false
): {
  claimAsync(selectedUdid?: string): Promise<PreinstalledApp | undefined>;
  preinstallOnDeviceAsync(udid: string, boot: Promise<unknown>, signal: AbortSignal): Promise<void>;
  stopAsync(selectedUdid?: string): Promise<void>;
  resultPromise: Promise<void>;
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
    const response = await fetch(VERSIONS_URL, { headers: HEADERS, signal: downloadSignal });
    if (!response.ok) {
      throw new Error(`Expo Go versions returned HTTP ${response.status}.`);
    }
    const { sdkVersions } = VersionsSchema.parse(await response.json());
    // Same latest stable release policy as expo.dev/go (GoScene/utils.ts).
    const sdk = Object.keys(sdkVersions)
      .filter(sdk => /\b(\d*)\.0\.0/.test(sdk))
      .slice(-10)
      .reverse()
      .find(sdk => sdkVersions[sdk].releaseNoteUrl && !sdkVersions[sdk].isBeta);
    const url = sdk && sdkVersions[sdk].iosClientUrl;
    if (!url || new URL(url).protocol !== 'https:') {
      throw new Error('No stable Expo Go Simulator archive is available.');
    }
    const archive = await fetch(url, { headers: HEADERS, signal: downloadSignal });
    if (!archive.ok || !archive.body) {
      throw new Error(`Expo Go archive returned HTTP ${archive.status}.`);
    }
    const archivePath = path.join(directoryPath, 'expo-go.tar.gz');
    await archive.body.pipeTo(Writable.toWeb(createWriteStream(archivePath)), {
      signal: downloadSignal,
    });
    downloadSignal.throwIfAborted();
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
          process.stderr.write(
            `Could not preinstall Expo Go; the job will install its requested app: ${error}\n`
          );
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
        process.stderr.write(
          `Could not preinstall Expo Go; the job will install its requested app: ${error}\n`
        );
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
  const initial = preinstallAsync(udid, boot, downloadSignal).catch(error => {
    failures.set(udid, error);
    throw error;
  });
  operations.add(initial);
  const resultPromise = reuseArchive ? initial : initial.finally(cleanUpAsync);
  void resultPromise.catch(error => {
    failures.set(udid, error);
  });
  return {
    resultPromise,
    async preinstallOnDeviceAsync(target, boot, deviceSignal) {
      if (downloadController.signal.aborted || cleanup) {
        return Promise.resolve();
      }
      const operation = preinstallAsync(target, boot, deviceSignal).catch(error => {
        failures.set(target, error);
        throw error;
      });
      operations.add(operation);
      const complete = operation.finally(cleanUpAsync);
      void complete.catch(error => {
        failures.set(target, error);
      });
      await complete;
    },
    async claimAsync(selectedUdid = udid) {
      downloadController.abort();
      void cleanUpAsync().catch(() => {});
      await installations.get(selectedUdid);
      if (failures.has(selectedUdid)) {
        throw failures.get(selectedUdid);
      }
      return installed.get(selectedUdid);
    },
    async stopAsync(selectedUdid = udid) {
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

async function readPreinstalledAppAsync(udid: string, appPath: string): Promise<PreinstalledApp> {
  const infoPlistPath = path.join(appPath, 'Info.plist');
  const [bundleIdentifier, shortVersion, version] = await Promise.all(
    ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion'].map(async key =>
      (await commands.runAsync('plutil', ['-extract', key, 'raw', '-o', '-', infoPlistPath])).trim()
    )
  );
  return { udid, bundleIdentifier, shortVersion, version };
}
