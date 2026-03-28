import downloadFile from '@expo/downloader';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import StreamZip from 'node-stream-zip';

import { BuildContext } from '../context';

let precompiledModulesPreparationPromise: Promise<void> | null = null;
const PRECOMPILED_MODULES_WAIT_TIMEOUT_MS = 30_000;
export const PRECOMPILED_MODULES_PATH = path.join(os.homedir(), '.expo', 'precompiled-modules');

export function shouldUsePrecompiledDependencies(env: Record<string, string | undefined>): boolean {
  return env.EAS_USE_PRECOMPILED_MODULES === '1';
}

export function maybeStartPreparingPrecompiledModules(
  ctx: BuildContext,
  config: { precompiledModulesUrls: string[] }
): void {
  if (!shouldUsePrecompiledDependencies(ctx.env)) {
    return;
  }

  startPreparingPrecompiledDependencies(ctx, config.precompiledModulesUrls);
}

export function startPreparingPrecompiledDependencies(ctx: BuildContext, urls: string[]): void {
  precompiledModulesPreparationPromise = preparePrecompiledDependenciesAsync({
    logger: ctx.logger,
    urls,
    destinationDirectory: PRECOMPILED_MODULES_PATH,
    cocoapodsProxyUrl: ctx.env.EAS_BUILD_COCOAPODS_CACHE_URL,
  });
}

export async function waitForPrecompiledModulesPreparationAsync(): Promise<void> {
  if (!precompiledModulesPreparationPromise) {
    return;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      precompiledModulesPreparationPromise,
      new Promise<void>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for precompiled dependencies after ${PRECOMPILED_MODULES_WAIT_TIMEOUT_MS / 1000} seconds`
            )
          );
        }, PRECOMPILED_MODULES_WAIT_TIMEOUT_MS);
        timeoutHandle.unref?.();
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function preparePrecompiledDependenciesAsync({
  logger,
  urls,
  destinationDirectory,
  cocoapodsProxyUrl,
}: {
  logger: bunyan;
  urls: string[];
  destinationDirectory: string;
  cocoapodsProxyUrl?: string;
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
    'Starting precompiled dependencies download'
  );

  await fs.remove(destinationDirectory);
  await fs.mkdirp(destinationDirectory);

  try {
    const archives = urls.map((url, index) => ({
      archiveName: path.basename(new URL(url).pathname),
      url,
      archivePath: path.join(archiveDirectory, `precompiled-modules-${index}.zip`),
    }));

    await Promise.all(
      archives.map(async ({ url, archivePath }) => {
        await downloadPrecompiledModulesAsync({
          url,
          archivePath,
          cocoapodsProxyUrl,
          logger,
        });
      })
    );

    for (const { archiveName, url, archivePath } of archives) {
      logger.info({ archivePath, url }, `Downloaded ${archiveName}, extracting archive`);
      await extractZipAsync(archivePath, stagingDirectory);
      logger.info(
        { destinationDirectory: stagingDirectory },
        `Extracted ${archiveName} into staging precompiled dependencies directory`
      );
    }

    await fs.remove(destinationDirectory);
    await fs.move(stagingDirectory, destinationDirectory);
    logger.info({ destinationDirectory }, `Precompiled modules ready in ${destinationDirectory}`);
  } catch (error) {
    await fs.remove(stagingDirectory);
    await fs.remove(destinationDirectory);
    await fs.mkdirp(destinationDirectory);
    throw error;
  } finally {
    await fs.remove(archiveDirectory);
  }
}

async function downloadPrecompiledModulesAsync({
  url,
  archivePath,
  cocoapodsProxyUrl,
  logger,
}: {
  url: string;
  archivePath: string;
  cocoapodsProxyUrl?: string;
  logger: bunyan;
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
