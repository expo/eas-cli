import fs from 'fs';
import os from 'os';
import path from 'path';

import * as tar from 'tar';
import fg from 'fast-glob';
import { bunyan } from '@expo/logger';
import { BuildFunction, BuildStepInput, BuildStepInputValueTypeName } from '@expo/steps';
import z from 'zod';
import nullthrows from 'nullthrows';
import fetch from 'node-fetch';
import { asyncResult } from '@expo/results';
import { Platform } from '@expo/eas-build-job';

import { retryOnDNSFailure } from '../../utils/retryOnDNSFailure';
import { formatBytes } from '../../utils/artifacts';
import { getCacheVersion } from '../utils/cache';

export function createSaveCacheFunction(): BuildFunction {
  return new BuildFunction({
    namespace: 'eas',
    id: 'save_cache',
    name: 'Save Cache',
    __metricsId: 'eas/save_cache',
    inputProviders: [
      BuildStepInput.createProvider({
        id: 'path',
        required: false,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
      BuildStepInput.createProvider({
        id: 'key',
        required: true,
        allowedValueTypeName: BuildStepInputValueTypeName.STRING,
      }),
    ],
    fn: async (stepsCtx, { env, inputs }) => {
      const { logger } = stepsCtx;

      try {
        const paths = z
          .array(z.string())
          .parse(((inputs.path.value ?? '') as string).split(/[\r\n]+/))
          .filter((path) => path.length > 0);
        const key = z.string().parse(inputs.key.value);
        const jobId = nullthrows(env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set');
        const robotAccessToken = nullthrows(
          stepsCtx.global.staticContext.job.secrets?.robotAccessToken,
          'robotAccessToken is not set'
        );

        const { archivePath } = await compressCacheAsync({
          paths,
          workingDirectory: stepsCtx.workingDirectory,
          verbose: true,
          logger,
        });

        const { size } = await fs.promises.stat(archivePath);

        if (env.EAS_PUBLIC_CACHE === '1') {
          await uploadPublicCacheAsync({
            logger,
            jobId,
            expoApiServerURL: stepsCtx.global.staticContext.expoApiServerURL,
            robotAccessToken,
            archivePath,
            key,
            paths,
            size,
            platform: stepsCtx.global.staticContext.job.platform,
          });
        } else {
          await uploadCacheAsync({
            logger,
            jobId,
            expoApiServerURL: stepsCtx.global.staticContext.expoApiServerURL,
            robotAccessToken,
            archivePath,
            key,
            paths,
            size,
            platform: stepsCtx.global.staticContext.job.platform,
          });
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to create cache');
      }
    },
  });
}

export async function uploadCacheAsync({
  logger,
  jobId,
  expoApiServerURL,
  robotAccessToken,
  paths,
  key,
  archivePath,
  size,
  platform,
}: {
  logger: bunyan;
  jobId: string;
  expoApiServerURL: string;
  robotAccessToken: string;
  paths: string[];
  key: string;
  archivePath: string;
  size: number;
  platform: Platform | undefined;
}): Promise<void> {
  const routerURL = platform
    ? 'v2/turtle-builds/caches/upload-sessions'
    : 'v2/turtle-caches/upload-sessions';

  // attempts to upload should only attempt on DNS errors, and not application errors such as 409 (cache exists)
  const response = await retryOnDNSFailure(fetch)(new URL(routerURL, expoApiServerURL), {
    method: 'POST',
    body: platform
      ? JSON.stringify({
          buildId: jobId,
          key,
          version: getCacheVersion(paths),
          size,
        })
      : JSON.stringify({
          jobRunId: jobId,
          key,
          version: getCacheVersion(paths),
          size,
        }),
    headers: {
      Authorization: `Bearer ${robotAccessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    if (response.status === 409) {
      logger.info(`Cache already exists, skipping upload`);
      return;
    }
    const textResult = await asyncResult(response.text());
    throw new Error(`Unexpected response from server (${response.status}): ${textResult.value}`);
  }

  const result = await asyncResult(response.json());
  if (!result.ok) {
    throw new Error(`Unexpected response from server (${response.status}): ${result.reason}`);
  }

  const { url, headers } = result.value.data;

  logger.info(`Uploading cache...`);

  const uploadResponse = await retryOnDNSFailure(fetch)(new URL(url), {
    method: 'PUT',
    headers,
    body: fs.createReadStream(archivePath),
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Unexpected response from cache server (${uploadResponse.status}): ${uploadResponse.statusText}`
    );
  }
  logger.info(`Uploaded cache archive to ${archivePath} (${formatBytes(size)}).`);
}

export async function uploadPublicCacheAsync({
  logger,
  jobId,
  expoApiServerURL,
  robotAccessToken,
  paths,
  key,
  archivePath,
  size,
}: {
  logger: bunyan;
  jobId: string;
  expoApiServerURL: string;
  robotAccessToken: string;
  paths: string[];
  key: string;
  archivePath: string;
  size: number;
  platform: Platform | undefined;
}): Promise<void> {
  const routerPath = 'v2/public-turtle-caches/upload-sessions';
  const response = await retryOnDNSFailure(fetch)(new URL(routerPath, expoApiServerURL), {
    method: 'POST',
    body: JSON.stringify({
      jobRunId: jobId,
      key,
      version: getCacheVersion(paths),
      size,
    }),
    headers: {
      Authorization: `Bearer ${robotAccessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    if (response.status === 409) {
      logger.info(`Cache ${key} already exists, skipping upload`);
      return;
    }
    const textResult = await asyncResult(response.text());
    throw new Error(`Unexpected response from server (${response.status}): ${textResult.value}`);
  }

  const result = await asyncResult(response.json());
  if (!result.ok) {
    throw new Error(`Unexpected response from server (${response.status}): ${result.reason}`);
  }

  const { url, headers } = result.value.data;

  logger.info(`Uploading public cache...`);

  const uploadResponse = await retryOnDNSFailure(fetch)(new URL(url), {
    method: 'PUT',
    headers,
    body: fs.createReadStream(archivePath),
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Unexpected response from cache server (${uploadResponse.status}): ${uploadResponse.statusText}`
    );
  }
  logger.info(`Uploaded cache archive to ${archivePath} (${formatBytes(size)}).`);
}

export async function compressCacheAsync({
  paths,
  workingDirectory,
  verbose,
  logger,
}: {
  paths: string[];
  workingDirectory: string;
  verbose: boolean;
  logger: bunyan;
}): Promise<{ archivePath: string }> {
  const archiveDestinationDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'save-cache-')
  );

  // Process and normalize all paths
  const allFiles: { absolutePath: string; archivePath: string }[] = [];

  for (const inputPath of paths) {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(workingDirectory, inputPath);

    try {
      const stat = await fs.promises.stat(absolutePath);

      if (stat.isDirectory()) {
        // For directories, get all files recursively
        const pattern = fg.isDynamicPattern(inputPath) ? inputPath : `${absolutePath}/**`;
        const dirFiles = await fg(pattern, {
          absolute: true,
          onlyFiles: true,
          cwd: fg.isDynamicPattern(inputPath) ? workingDirectory : undefined,
        });

        for (const filePath of dirFiles) {
          // Calculate the archive path
          let archivePath: string;

          if (path.isAbsolute(inputPath)) {
            // For absolute input paths, check if they're within workingDirectory
            const relativeToWorkdir = path.relative(workingDirectory, filePath);
            if (!relativeToWorkdir.startsWith('..') && !path.isAbsolute(relativeToWorkdir)) {
              // File is within working directory - use relative path
              archivePath = relativeToWorkdir;
            } else {
              // File is outside working directory - preserve relative structure from original path
              const relativeToInput = path.relative(absolutePath, filePath);
              archivePath = path.posix.join('__absolute__' + inputPath, relativeToInput);
            }
          } else {
            // For relative input paths, maintain relative structure
            archivePath = path.relative(workingDirectory, filePath);
          }

          allFiles.push({ absolutePath: filePath, archivePath });
        }
      } else {
        // Single file
        let archivePath: string;

        if (path.isAbsolute(inputPath)) {
          const relativeToWorkdir = path.relative(workingDirectory, absolutePath);
          if (!relativeToWorkdir.startsWith('..') && !path.isAbsolute(relativeToWorkdir)) {
            archivePath = relativeToWorkdir;
          } else {
            archivePath = '__absolute__' + inputPath;
          }
        } else {
          archivePath = inputPath;
        }

        allFiles.push({ absolutePath, archivePath });
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to resolve paths');
      // Handle glob patterns
      if (fg.isDynamicPattern(inputPath)) {
        const globFiles = await fg(inputPath, {
          absolute: true,
          cwd: workingDirectory,
          onlyFiles: true,
        });

        for (const filePath of globFiles) {
          const archivePath = path.relative(workingDirectory, filePath);
          allFiles.push({ absolutePath: filePath, archivePath });
        }
      } else {
        throw new Error(`Path does not exist: ${inputPath}`);
      }
    }
  }

  if (allFiles.length === 0) {
    throw new Error('No files found to cache');
  }

  const archivePath = path.join(archiveDestinationDirectory, 'cache.tar.gz');

  if (verbose) {
    logger.info(`Compressing cache with ${allFiles.length} files:`);
  }

  // Create a temporary directory with the correct structure
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cache-temp-'));

  try {
    // Copy all files to temp directory maintaining archive structure
    for (const { absolutePath, archivePath: targetRelativePath } of allFiles) {
      const targetPath = path.join(tempDir, targetRelativePath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.copyFile(absolutePath, targetPath);

      if (verbose) {
        logger.info(`- ${targetRelativePath}`);
      }
    }

    // Create tar archive from the structured temp directory
    await tar.c(
      {
        gzip: true,
        file: archivePath,
        cwd: tempDir,
      },
      allFiles.map(({ archivePath: targetPath }) => targetPath)
    );
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }

  return { archivePath };
}
