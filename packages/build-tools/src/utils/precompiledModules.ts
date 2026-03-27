import downloadFile from '@expo/downloader';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import * as tar from 'tar';

import { BuildContext } from '../context';

let precompiledModulesPreparationPromise: Promise<void> | null = null;
export const PRECOMPILED_MODULES_PATH = path.join(os.homedir(), '.expo', 'precompiled-modules');

export function shouldUsePrecompiledDependencies(env: Record<string, string | undefined>): boolean {
  return env.EAS_USE_PRECOMPILED_MODULES === '1';
}

export function maybeStartPreparingPrecompiledModules(
  ctx: BuildContext,
  config: { precompiledModulesUrl: string }
): void {
  if (!shouldUsePrecompiledDependencies(ctx.env)) {
    return;
  }

  startPreparingPrecompiledDependencies(ctx, config.precompiledModulesUrl);
}

export function startPreparingPrecompiledDependencies(ctx: BuildContext, url: string): void {
  precompiledModulesPreparationPromise = preparePrecompiledDependenciesAsync({
    logger: ctx.logger,
    url,
    destinationDirectory: PRECOMPILED_MODULES_PATH,
    cocoapodsProxyUrl: ctx.env.EAS_BUILD_COCOAPODS_CACHE_URL,
  });
}

export async function waitForPrecompiledModulesPreparationAsync(): Promise<void> {
  await precompiledModulesPreparationPromise;
}

async function preparePrecompiledDependenciesAsync({
  logger,
  url,
  destinationDirectory,
  cocoapodsProxyUrl,
}: {
  logger: bunyan;
  url: string;
  destinationDirectory: string;
  cocoapodsProxyUrl?: string;
}): Promise<void> {
  const archiveDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'precompiled-modules-'));
  const archivePath = path.join(archiveDirectory, 'precompiled-modules.tar.gz');

  logger.info(
    {
      destinationDirectory,
      url,
    },
    'Starting precompiled dependencies download'
  );

  await fs.remove(destinationDirectory);
  await fs.mkdirp(destinationDirectory);

  try {
    await downloadPrecompiledModulesAsync({
      url,
      archivePath,
      cocoapodsProxyUrl,
      logger,
    });
    logger.info({ archivePath }, 'Downloaded precompiled dependencies, extracting archive');
    await tar.extract({
      file: archivePath,
      cwd: destinationDirectory,
    });
    logger.info({ destinationDirectory }, 'Prepared precompiled dependencies');
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
    ? rewriteUrlThroughCocoapodsProxy({ url, cocoapodsProxyUrl })
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

function rewriteUrlThroughCocoapodsProxy({
  url,
  cocoapodsProxyUrl,
}: {
  url: string;
  cocoapodsProxyUrl: string;
}): string {
  const parsedUrl = new URL(url);
  return `${cocoapodsProxyUrl}/${parsedUrl.hostname}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
}
