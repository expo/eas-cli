import path from 'path';

import fs from 'fs-extra';
import fg from 'fast-glob';
import { bunyan } from '@expo/logger';
import { ManagedArtifactType, Job, BuildJob } from '@expo/eas-build-job';
import promiseLimit from 'promise-limit';

import { BuildContext } from '../context';

export class FindArtifactsError extends Error {}

export async function findArtifacts({
  rootDir,
  patternOrPath,
  logger,
}: {
  rootDir: string;
  patternOrPath: string;
  /** If provided, will log error suggesting possible files to upload. */
  logger: bunyan | null;
}): Promise<string[]> {
  const files = path.isAbsolute(patternOrPath)
    ? (await fs.pathExists(patternOrPath))
      ? [patternOrPath]
      : []
    : await fg(patternOrPath, { cwd: rootDir, onlyFiles: false });
  if (files.length === 0) {
    if (fg.isDynamicPattern(patternOrPath)) {
      throw new FindArtifactsError(`There are no files matching pattern "${patternOrPath}"`);
    } else {
      if (logger) {
        await logMissingFileError(path.join(rootDir, patternOrPath), logger);
      }
      throw new FindArtifactsError(`No such file or directory ${patternOrPath}`);
    }
  }

  return files.map((filePath) => {
    // User may provide an absolute path as input in which case
    // fg will return an absolute path.
    if (path.isAbsolute(filePath)) {
      return filePath;
    }

    // User may also provide a relative path in which case
    // fg will return a path relative to rootDir.
    return path.join(rootDir, filePath);
  });
}

async function logMissingFileError(artifactPath: string, buildLogger: bunyan): Promise<void> {
  let currentPath = artifactPath;
  while (!(await fs.pathExists(currentPath))) {
    currentPath = path.resolve(currentPath, '..');
  }
  if (currentPath === path.resolve(currentPath, '..')) {
    buildLogger.error(`There is no such file or directory "${artifactPath}".`);
    return;
  }
  const dirContent = await fs.readdir(currentPath);
  if (dirContent.length === 0) {
    buildLogger.error(
      `There is no such file or directory "${artifactPath}". Directory "${currentPath}" is empty.`
    );
  } else {
    buildLogger.error(
      `There is no such file or directory "${artifactPath}". Directory "${currentPath}" contains [${dirContent.join(
        ', '
      )}].`
    );
  }
}

export async function maybeFindAndUploadBuildArtifacts(
  ctx: BuildContext<BuildJob>,
  { logger }: { logger: bunyan }
): Promise<void> {
  if (!ctx.job.buildArtifactPaths || ctx.job.buildArtifactPaths.length === 0) {
    return;
  }
  try {
    const buildArtifacts = (
      await Promise.all(
        ctx.job.buildArtifactPaths.map((path) =>
          findArtifacts({
            rootDir: ctx.getReactNativeProjectDirectory(),
            patternOrPath: path,
            logger,
          })
        )
      )
    ).flat();
    const artifactsSizes = await getArtifactsSizes(buildArtifacts);
    logger.info(`Build artifacts:`);
    for (const artifactPath of buildArtifacts) {
      const maybeSize = artifactsSizes[artifactPath];
      logger.info(`  - ${artifactPath}${maybeSize ? ` (${formatBytes(maybeSize)})` : ''}`);
    }
    logger.info('Uploading build artifacts...');
    await ctx.uploadArtifact({
      artifact: {
        type: ManagedArtifactType.BUILD_ARTIFACTS,
        paths: buildArtifacts,
      },
      logger,
    });
  } catch (err: any) {
    logger.error({ err }, 'Failed to upload build artifacts');
  }
}

export async function uploadApplicationArchive(
  ctx: BuildContext<Job>,
  {
    logger,
    patternOrPath,
    rootDir,
  }: {
    logger: bunyan;
    patternOrPath: string;
    rootDir: string;
  }
): Promise<void> {
  const applicationArchives = await findArtifacts({ rootDir, patternOrPath, logger });
  const artifactsSizes = await getArtifactsSizes(applicationArchives);
  logger.info(`Application archives:`);
  for (const artifactPath of applicationArchives) {
    const maybeSize = artifactsSizes[artifactPath];
    logger.info(`  - ${artifactPath}${maybeSize ? ` (${formatBytes(maybeSize)})` : ''}`);
  }
  logger.info('Uploading application archive...');
  await ctx.uploadArtifact({
    artifact: {
      type: ManagedArtifactType.APPLICATION_ARCHIVE,
      paths: applicationArchives,
    },
    logger,
  });
}

async function getArtifactsSizes(artifacts: string[]): Promise<Record<string, number | undefined>> {
  const artifactsSizes: Record<string, number | undefined> = {};
  await Promise.all(
    artifacts.map(async (artifact) => {
      artifactsSizes[artifact] = await getArtifactSize(artifact);
    })
  );
  return artifactsSizes;
}

async function getArtifactSize(artifact: string): Promise<number | undefined> {
  try {
    const stat = await fs.stat(artifact);
    if (!stat.isDirectory()) {
      return stat.size;
    } else {
      const files = await fg('**/*', { cwd: artifact, onlyFiles: true });

      if (files.length > 100_000) {
        return undefined;
      }

      const getFileSizePromiseLimit = promiseLimit<number>(100);
      const sizes = await Promise.all(
        files.map((file) =>
          getFileSizePromiseLimit(async () => (await fs.stat(path.join(artifact, file))).size)
        )
      );
      return sizes.reduce((acc, size) => acc + size, 0);
    }
  } catch {
    return undefined;
  }
}

// same as in
// https://github.com/expo/eas-cli/blob/f0e3b648a1634266e7d723bd49a84866ab9b5801/packages/eas-cli/src/utils/files.ts#L33-L60
export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return `0`;
  }
  let multiplier = 1;
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes)} B`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} KB`;
  }
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes / 1024)} KB`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} MB`;
  }
  if (bytes < 1024 * multiplier) {
    return `${Math.floor(bytes / multiplier)} MB`;
  }
  multiplier *= 1024;
  if (bytes < 102.4 * multiplier) {
    return `${(bytes / multiplier).toFixed(1)} GB`;
  }
  return `${Math.floor(bytes / 1024)} GB`;
}
