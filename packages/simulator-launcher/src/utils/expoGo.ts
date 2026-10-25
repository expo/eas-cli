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

/** Warm only this initial device. Claim prevents new installs; a started install must finish. */
export function startExpoGoPreinstall(
  udid: string,
  boot: Promise<unknown>,
  signal: AbortSignal
): {
  /** Resolves with the installed Expo Go, or undefined when the preinstall did not finish. */
  claimAsync(): Promise<PreinstalledApp | undefined>;
  stopAsync(): Promise<void>;
  resultPromise: Promise<void>;
} {
  const downloadController = new AbortController();
  const downloadSignal = AbortSignal.any([
    signal,
    downloadController.signal,
    AbortSignal.timeout(120_000),
  ]);
  let installation: Promise<void> | undefined;
  let installed: PreinstalledApp | undefined;
  let failure: unknown;
  void boot.catch(() => {});
  const warmup = (async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'simulator-expo-go-'));
    try {
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
      const archivePath = path.join(directory, 'expo-go.tar.gz');
      await archive.body.pipeTo(Writable.toWeb(createWriteStream(archivePath)), {
        signal: downloadSignal,
      });
      downloadSignal.throwIfAborted();
      // Wait for the owned extractor to close, including on bad archives and claim/stop.
      const appPath = path.join(directory, 'ExpoGo.app');
      await fs.mkdir(appPath);
      await commands.runAsync('/usr/bin/tar', ['-xzf', archivePath, '-C', appPath]);
      downloadSignal.throwIfAborted();
      await fs.access(path.join(appPath, 'Info.plist'));
      await boot;
      downloadSignal.throwIfAborted();
      // No await between this latch and launch. Claim cannot race a not-yet-started install.
      process.stderr.write(`Preinstalling Expo Go for SDK ${sdk} on Simulator ${udid}.\n`);
      installation = commands.runAsync('xcrun', ['simctl', 'install', udid, appPath]).then(
        async () => {
          process.stderr.write('Expo Go preinstall finished.\n');
          // The job compares its app with this record instead of asking the Simulator.
          installed = await readPreinstalledAppAsync(udid, appPath).catch(error => {
            process.stderr.write(`Could not read the preinstalled Expo Go version: ${error}\n`);
            return undefined;
          });
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
      await installation;
    } catch (error) {
      commands.throwIfCommandCloseTimedOut();
      // A signal exit is not evidence that the native installation transaction finished.
      if (installation) {
        throw error;
      }
      if (!signal.aborted && !downloadController.signal.aborted) {
        process.stderr.write(
          `Could not preinstall Expo Go; the job will install its requested app: ${error}\n`
        );
      }
    } finally {
      // A rejected command with unproved close must not race removal or permit a stopped ack.
      commands.throwIfCommandCloseTimedOut();
      await fs.rm(directory, { recursive: true, force: true });
    }
  })();
  void warmup.catch(error => {
    failure = error;
  });
  return {
    resultPromise: warmup,
    async claimAsync() {
      downloadController.abort();
      await installation;
      if (failure) {
        throw failure;
      }
      commands.throwIfCommandCloseTimedOut();
      return installed;
    },
    async stopAsync() {
      downloadController.abort();
      await warmup;
      commands.throwIfCommandCloseTimedOut();
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
