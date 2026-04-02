import downloadFile from '@expo/downloader';
import { SystemError } from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import StreamZip from 'node-stream-zip';
import os from 'os';
import path from 'path';

import { BuildContext } from '../context';

let thirdPartyPrecompiledModulesPreparationPromise: Promise<void> | null = null;
let thirdPartyPrecompiledModulesPreparationAbortController: AbortController | null = null;
const THIRD_PARTY_PRECOMPILED_MODULES_WAIT_TIMEOUT_MS = 15_000;
export const THIRD_PARTY_PRECOMPILED_MODULES_PATH = path.join(
  os.homedir(),
  '.expo',
  'precompiled-modules'
);

export function shouldUsePrecompiledDependencies(env: Record<string, string | undefined>): boolean {
  return env.EAS_USE_PRECOMPILED_MODULES === '1';
}

export function shouldPrepareThirdPartyPrecompiledModules(
  env: Record<string, string | undefined>
): boolean {
  return (
    shouldUsePrecompiledDependencies(env) && env.EAS_DISABLE_THIRD_PARTY_PRECOMPILED_MODULES !== '1'
  );
}

export function maybeStartPreparingThirdPartyPrecompiledModules(
  ctx: BuildContext,
  config: { thirdPartyPrecompiledModulesUrls: string[] }
): void {
  if (!shouldPrepareThirdPartyPrecompiledModules(ctx.env)) {
    return;
  }

  startPreparingThirdPartyPrecompiledModules(ctx, config.thirdPartyPrecompiledModulesUrls);
}

export function startPreparingThirdPartyPrecompiledModules(
  ctx: BuildContext,
  urls: string[]
): void {
  const abortController = new AbortController();
  thirdPartyPrecompiledModulesPreparationAbortController = abortController;

  thirdPartyPrecompiledModulesPreparationPromise = prepareThirdPartyPrecompiledModulesAsync({
    logger: ctx.logger,
    urls,
    destinationDirectory: THIRD_PARTY_PRECOMPILED_MODULES_PATH,
    cocoapodsProxyUrl: ctx.env.EAS_BUILD_COCOAPODS_CACHE_URL,
    signal: abortController.signal,
  });

  void thirdPartyPrecompiledModulesPreparationPromise.catch(error => {
    ctx.logger.error({ error }, 'Failed to prepare third-party precompiled dependencies');
  });
}

export async function waitForThirdPartyPrecompiledModulesPreparationAsync(): Promise<void> {
  if (!thirdPartyPrecompiledModulesPreparationPromise) {
    return;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      thirdPartyPrecompiledModulesPreparationPromise,
      new Promise<void>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new SystemError(
              `Timed out waiting for third-party precompiled dependencies after ${THIRD_PARTY_PRECOMPILED_MODULES_WAIT_TIMEOUT_MS / 1000} seconds`,
              {
                metadata: {
                  timeoutMs: THIRD_PARTY_PRECOMPILED_MODULES_WAIT_TIMEOUT_MS,
                },
              }
            )
          );
          thirdPartyPrecompiledModulesPreparationAbortController?.abort();
        }, THIRD_PARTY_PRECOMPILED_MODULES_WAIT_TIMEOUT_MS);
        timeoutHandle.unref?.();
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function prepareThirdPartyPrecompiledModulesAsync({
  logger,
  urls,
  destinationDirectory,
  cocoapodsProxyUrl,
  signal,
}: {
  logger: bunyan;
  urls: string[];
  destinationDirectory: string;
  cocoapodsProxyUrl?: string;
  signal: AbortSignal;
}): Promise<void> {
  const archiveDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'precompiled-modules-'));
  const destinationParentDirectory = path.dirname(destinationDirectory);
  await fs.mkdirp(destinationParentDirectory);
  const stagingDirectory = await fs.mkdtemp(
    path.join(destinationParentDirectory, `${path.basename(destinationDirectory)}-staging-`)
  );

  logger.info('');
  logger.info(
    {
      destinationDirectory,
      urls,
    },
    'Starting third-party precompiled dependencies download'
  );

  await fs.remove(destinationDirectory);
  await fs.mkdirp(destinationDirectory);

  try {
    throwIfPreparationAborted(signal);
    const archives = urls.map((url, index) => ({
      archiveName: path.basename(new URL(url).pathname),
      url,
      archivePath: path.join(archiveDirectory, `precompiled-modules-${index}.zip`),
    }));

    await Promise.all(
      archives.map(async ({ url, archivePath }) => {
        await downloadThirdPartyPrecompiledModulesAsync({
          url,
          archivePath,
          cocoapodsProxyUrl,
          logger,
          signal,
        });
      })
    );

    for (const { archiveName, url, archivePath } of archives) {
      throwIfPreparationAborted(signal);
      logger.info({ archivePath, url }, `Downloaded ${archiveName}, extracting archive`);
      await extractZipAsync(archivePath, stagingDirectory);
      logger.info(
        { destinationDirectory: stagingDirectory },
        `Extracted ${archiveName} into staging third-party precompiled dependencies directory`
      );
    }

    throwIfPreparationAborted(signal);
    // Keep the final publish step synchronous so the timeout callback cannot interleave
    // between removing the old directory and moving the staged one into place.
    fs.removeSync(destinationDirectory);
    fs.moveSync(stagingDirectory, destinationDirectory);
    logger.info(
      { destinationDirectory },
      `Third-party precompiled modules ready in ${destinationDirectory}`
    );
  } catch (error) {
    await fs.remove(stagingDirectory);
    await fs.remove(destinationDirectory);
    await fs.mkdirp(destinationDirectory);
    throw error;
  } finally {
    await fs.remove(archiveDirectory);
  }
}

async function downloadThirdPartyPrecompiledModulesAsync({
  url,
  archivePath,
  cocoapodsProxyUrl,
  logger,
  signal,
}: {
  url: string;
  archivePath: string;
  cocoapodsProxyUrl?: string;
  logger: bunyan;
  signal: AbortSignal;
}): Promise<void> {
  const proxiedUrl = cocoapodsProxyUrl
    ? (() => {
        const parsedUrl = new URL(url);
        return `${cocoapodsProxyUrl}/${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
      })()
    : null;
  if (proxiedUrl) {
    try {
      await downloadFile(proxiedUrl, archivePath, { retry: 3 });
      return;
    } catch (err) {
      throwIfPreparationAborted(signal);
      logger.warn(
        { err, proxiedUrl },
        'Failed to download through CocoaPods proxy, retrying directly'
      );
    }
  }

  await downloadFile(url, archivePath, { retry: 3 });
}

async function extractZipAsync(archivePath: string, destinationDirectory: string): Promise<void> {
  const zip = new StreamZip.async({ file: archivePath });
  try {
    await zip.extract(null, destinationDirectory);
  } finally {
    await zip.close();
  }
}

function throwIfPreparationAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('Third-party precompiled dependencies preparation aborted');
  }
}
