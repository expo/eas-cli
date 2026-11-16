import downloadFile from '@expo/downloader';
import type { bunyan } from '@expo/logger';
import type { BuildStepEnv } from '@expo/steps';
import spawn from '@expo/turtle-spawn';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import semver from 'semver';
import { z } from 'zod';

import { Sentry } from '../../sentry';
import { getProxiedDownloadUrl } from '../../utils/download';
import { sleepAsync } from '../../utils/retry';
import { turtleFetch } from '../../utils/turtleFetch';

// npm can list a new expo-device-hub or serve-sim release before it serves the tarball, for
// example while the npm security scan runs, and a session that starts then fails. The
// expo-device-hub release copies each release into this bucket and moves `<name>/latest.json`
// after it checked the copy against npm's `dist.integrity` (expo/expo-device-hub LLP 0019). So a
// session reads the copy first, and npm second.
export const DEVICE_PACKAGE_MIRROR_BASE_URL = 'https://storage.googleapis.com/turtle-v2/npm';
/** A step env value that replaces the mirror base URL, like `SERVE_EMU_SCRCPY_BASE_URL`. */
export const DEVICE_PACKAGE_MIRROR_URL_ENV = 'EAS_DEVICE_PACKAGE_MIRROR_URL';

const POINTER_TIMEOUT_MS = 10_000;
const TARBALL_TIMEOUT_MS = 120_000;
const NPM_PACK_TIMEOUT_MS = 120_000;
const DEFAULT_NPM_RETRY_DELAYS_MS = [5_000, 15_000];

const MirrorPointerSchema = z.object({
  name: z.string(),
  version: z.string().refine(version => semver.valid(version) !== null),
  tarball: z.string().regex(/^-\/[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
});

const NpmPackOutputSchema = z
  .array(z.object({ name: z.string(), version: z.string(), filename: z.string() }))
  .min(1);

export type DevicePackageSource = 'mirror' | 'npm';

export type ResolvedDevicePackage = {
  /** What the package manager runs: a local tarball (`file:`) or `<name>@latest`. */
  packageSpec: string;
  /** For logs, for example `expo-device-hub@0.24.0 from the EAS package mirror`. */
  description: string;
  source: DevicePackageSource;
  version?: string;
};

/**
 * Downloads the latest release of a device session package: from the EAS package mirror after
 * the sha512 check, else from npm with retries. When both fail, it returns `<name>@latest`, which
 * the package manager resolves as before.
 *
 * The tarball stays in a temporary directory until the job ends: iOS recorders start serve-sim
 * from the same spec during the whole session.
 */
export async function resolveLatestDevicePackageAsync({
  packageName,
  env,
  logger,
  signal,
  npmRetryDelaysMs = DEFAULT_NPM_RETRY_DELAYS_MS,
}: {
  packageName: string;
  env: BuildStepEnv;
  logger: bunyan;
  signal?: AbortSignal;
  npmRetryDelaysMs?: number[];
}): Promise<ResolvedDevicePackage> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eas-device-package-'));
  try {
    const { tarballPath, version } = await downloadFromMirrorAsync({
      packageName,
      directory,
      env,
      signal,
    });
    const description = `${packageName}@${version} from the EAS package mirror`;
    logger.info(`Using ${description}.`);
    return { packageSpec: `file:${tarballPath}`, description, source: 'mirror', version };
  } catch (err) {
    signal?.throwIfAborted();
    logger.warn(
      { err },
      `Could not use ${packageName} from the EAS package mirror. Downloading ${packageName}@latest from npm.`
    );
    Sentry.capture(`Could not use ${packageName} from the EAS package mirror`, toError(err), {
      level: 'warning',
      tags: { packageName },
    });
  }
  try {
    const { tarballPath, version } = await packFromNpmAsync({
      packageName,
      directory,
      env,
      signal,
      retryDelaysMs: npmRetryDelaysMs,
    });
    const description = `${packageName}@${version} from npm`;
    logger.info(`Using ${description}.`);
    return { packageSpec: `file:${tarballPath}`, description, source: 'npm', version };
  } catch (err) {
    signal?.throwIfAborted();
    logger.warn(
      { err },
      `Could not download ${packageName}@latest from npm. The package manager resolves ${packageName}@latest itself.`
    );
  }
  return {
    packageSpec: `${packageName}@latest`,
    description: `${packageName}@latest`,
    source: 'npm',
  };
}

async function downloadFromMirrorAsync({
  packageName,
  directory,
  env,
  signal,
}: {
  packageName: string;
  directory: string;
  env: BuildStepEnv;
  signal?: AbortSignal;
}): Promise<{ tarballPath: string; version: string }> {
  const baseUrl = (env[DEVICE_PACKAGE_MIRROR_URL_ENV] || DEVICE_PACKAGE_MIRROR_BASE_URL).replace(
    /\/+$/,
    ''
  );
  // The pointer is never read through the cache proxy, which could serve an old release.
  const response = await turtleFetch(`${baseUrl}/${packageName}/latest.json`, 'GET', {
    retries: 2,
    timeout: POINTER_TIMEOUT_MS,
    signal,
  });
  const pointer = MirrorPointerSchema.parse(await response.json());
  if (pointer.name !== packageName) {
    throw new Error(`The mirror pointer names ${pointer.name}, not ${packageName}.`);
  }
  const tarballUrl = `${baseUrl}/${packageName}/${pointer.tarball}`;
  const tarballPath = path.join(directory, path.posix.basename(pointer.tarball));
  // A tarball never changes after the upload, so the iOS cache proxy can serve it.
  const proxiedUrl = getProxiedDownloadUrl({
    directUrl: tarballUrl,
    proxyBaseUrl: env.EAS_BUILD_COCOAPODS_CACHE_URL,
  });
  let downloaded = false;
  if (proxiedUrl) {
    downloaded = await downloadFile(proxiedUrl, tarballPath, {
      retry: 1,
      timeout: TARBALL_TIMEOUT_MS,
    }).then(
      () => true,
      () => false
    );
  }
  signal?.throwIfAborted();
  if (!downloaded) {
    await downloadFile(tarballUrl, tarballPath, { retry: 2, timeout: TARBALL_TIMEOUT_MS });
  }
  signal?.throwIfAborted();
  const integrity = await sha512IntegrityAsync(tarballPath);
  if (integrity !== pointer.integrity) {
    await fs.promises.rm(tarballPath, { force: true });
    throw new Error(
      `${packageName}@${pointer.version} from the mirror has sha512 ${integrity}, not ${pointer.integrity}.`
    );
  }
  return { tarballPath, version: pointer.version };
}

/** `npm pack` uses the job's npm configuration and checks the tarball against npm's integrity. */
async function packFromNpmAsync({
  packageName,
  directory,
  env,
  signal,
  retryDelaysMs,
}: {
  packageName: string;
  directory: string;
  env: BuildStepEnv;
  signal?: AbortSignal;
  retryDelaysMs: number[];
}): Promise<{ tarballPath: string; version: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      await sleepAsync(retryDelaysMs[attempt - 1]);
    }
    signal?.throwIfAborted();
    try {
      const { stdout } = await spawn(
        'npm',
        ['pack', `${packageName}@latest`, '--pack-destination', directory, '--json'],
        { cwd: directory, env, signal, stdio: 'pipe', timeout: NPM_PACK_TIMEOUT_MS }
      );
      const [packed] = NpmPackOutputSchema.parse(JSON.parse(stdout));
      return { tarballPath: path.join(directory, packed.filename), version: packed.version };
    } catch (err) {
      signal?.throwIfAborted();
      lastError = err;
    }
  }
  throw lastError;
}

async function sha512IntegrityAsync(filePath: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return `sha512-${hash.digest('base64')}`;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
