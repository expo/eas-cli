import { type bunyan } from '@expo/logger';
import { type BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import fetch from 'node-fetch';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { z } from 'zod';

export const SIMULATOR_IMAGE_DIRECTORY = '/Users/expo/.local/share/eas-simulator';
export const SIMULATOR_IMAGE_MANIFEST = path.join(SIMULATOR_IMAGE_DIRECTORY, 'manifest.json');
const SIMULATOR_IMAGE_HELPER = '/usr/local/libexec/expo-sim-service/sim_service.py';
const EXPO_GO_CACHE = '/Users/expo/.expo/ios-simulator-app-cache';

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  expoGo: z.array(z.object({ url: z.string(), version: z.string(), path: z.string() })),
  packages: z.array(z.object({ name: z.string(), version: z.string(), path: z.string() })),
});

async function readManifestAsync(): Promise<z.infer<typeof ManifestSchema> | null> {
  if (process.platform !== 'darwin' || !fs.existsSync(SIMULATOR_IMAGE_MANIFEST)) {
    return null;
  }
  return ManifestSchema.parse(
    JSON.parse(await fs.promises.readFile(SIMULATOR_IMAGE_MANIFEST, 'utf8'))
  );
}

/** The image owns the preparation lock. Never fall back to a competing boot on failure. */
export async function claimImageSimulatorAsync({
  deviceIdentifier,
  env,
  logger,
}: {
  deviceIdentifier?: string;
  env: BuildStepEnv;
  logger: bunyan;
}): Promise<string | null> {
  if (!env.DEVICE_RUN_SESSION_ID || !(await readManifestAsync())) {
    return null;
  }
  const { stdout } = await spawn(
    '/opt/homebrew/bin/python3',
    [SIMULATOR_IMAGE_HELPER, 'claim', ...(deviceIdentifier ? ['--device', deviceIdentifier] : [])],
    { env, stdio: 'pipe' }
  );
  const { udid } = z.object({ udid: z.string().uuid() }).parse(JSON.parse(stdout));
  logger.info(`Claimed prepared iOS Simulator ${udid}; other simulators are shut down.`);
  return udid;
}

/** Exact URL identity only; copy into job-owned storage to protect the image cache. */
export async function copyImageExpoGoAsync({
  url,
  logger,
}: {
  url: string;
  logger: bunyan;
}): Promise<string | null> {
  let copyDirectory: string | undefined;
  try {
    const manifest = await readManifestAsync();
    const entry = manifest?.expoGo.find(entry => entry.url === url);
    if (
      !entry ||
      path.extname(entry.path) !== '.app' ||
      path.dirname(entry.path) !== EXPO_GO_CACHE
    ) {
      return null;
    }
    const { stdout } = await spawn(
      'plutil',
      ['-convert', 'json', '-o', '-', path.join(entry.path, 'Info.plist')],
      { stdio: 'pipe' }
    );
    const info = z
      .object({
        CFBundleIdentifier: z.literal('host.exp.Exponent'),
        CFBundleShortVersionString: z.literal(entry.version),
        CFBundleSupportedPlatforms: z
          .array(z.string())
          .refine(platforms => platforms.includes('iPhoneSimulator')),
        CFBundleExecutable: z.string().min(1),
      })
      .parse(JSON.parse(stdout));
    if (path.basename(info.CFBundleExecutable) !== info.CFBundleExecutable) {
      return null;
    }
    await fs.promises.access(path.join(entry.path, info.CFBundleExecutable));
    copyDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'download_build-image-'));
    const artifactPath = path.join(copyDirectory, path.basename(entry.path));
    await fs.promises.cp(entry.path, artifactPath, {
      recursive: true,
      mode: fs.constants.COPYFILE_FICLONE,
    });
    logger.info(`Using image-cached Expo Go ${entry.version}.`);
    return artifactPath;
  } catch (err) {
    if (copyDirectory) {
      await fs.promises.rm(copyDirectory, { recursive: true, force: true }).catch(() => {});
    }
    logger.warn({ err }, 'Could not use the image Expo Go cache; downloading normally.');
    return null;
  }
}

/** Preserve latest/range semantics: reuse a baked package only for the resolved version. */
export async function getImagePackageAsync({
  name,
  version = 'latest',
  logger,
}: {
  name: string;
  version?: string;
  logger: bunyan;
}): Promise<string | null> {
  try {
    const manifest = await readManifestAsync();
    const entry = manifest?.packages.find(entry => entry.name === name);
    if (
      !entry ||
      path.resolve(entry.path) !== entry.path ||
      !entry.path.startsWith(`${SIMULATOR_IMAGE_DIRECTORY}/tools/`)
    ) {
      return null;
    }
    // Arbitrary ranges/tags keep the existing package manager resolution path.
    let resolved = semver.valid(version);
    if (version === 'latest') {
      const response = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
        { timeout: 10_000 }
      );
      if (!response.ok) {
        throw new Error(`npm metadata returned HTTP ${response.status}`);
      }
      resolved = z
        .object({ name: z.literal(name), version: z.string() })
        .parse(await response.json()).version;
    }
    if (!resolved || resolved !== entry.version) {
      return null;
    }
    const installed = JSON.parse(
      await fs.promises.readFile(path.join(entry.path, 'package.json'), 'utf8')
    );
    if (installed.name !== name || installed.version !== resolved) {
      return null;
    }
    logger.info(`Using image-preinstalled ${name}@${resolved}.`);
    return entry.path;
  } catch (err) {
    logger.warn({ err }, `Could not use image-preinstalled ${name}; resolving normally.`);
    return null;
  }
}

export async function getImagePackageExecutableAsync(options: {
  name: string;
  version?: string;
  binaryName: string;
  logger: bunyan;
}): Promise<string | null> {
  const directory = await getImagePackageAsync(options);
  if (!directory) {
    return null;
  }
  try {
    const installed = JSON.parse(
      await fs.promises.readFile(path.join(directory, 'package.json'), 'utf8')
    );
    const bin =
      typeof installed.bin === 'string' ? installed.bin : installed.bin?.[options.binaryName];
    if (typeof bin !== 'string') {
      return null;
    }
    const executable = path.resolve(directory, bin);
    if (!executable.startsWith(`${directory}/`)) {
      return null;
    }
    await fs.promises.access(executable, fs.constants.X_OK);
    return executable;
  } catch {
    return null;
  }
}
