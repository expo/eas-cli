import path from 'path';

import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import * as tar from 'tar';

import config from './config';

export async function prepareArtifacts(
  artifactPaths: string[],
  logger?: bunyan
): Promise<{ filename: string }> {
  const l = logger?.child({ phase: 'PREPARE_ARTIFACTS' });
  l?.info('Preparing artifacts');
  let suffix;
  let localPath;
  if (artifactPaths.length === 1 && !(await fs.lstat(artifactPaths[0])).isDirectory()) {
    [localPath] = artifactPaths;
    suffix = path.extname(artifactPaths[0]);
  } else {
    const parentDir = artifactPaths.reduce(
      (acc, item) => getCommonParentDir(acc, item),
      artifactPaths[0]
    );
    const relativePathsToArchive = artifactPaths.map((absolute) =>
      path.relative(parentDir, absolute)
    );

    const archivePath = path.join(config.workingdir, 'artifacts.tar.gz');
    await tar.c(
      {
        gzip: true,
        file: archivePath,
        cwd: parentDir,
      },
      relativePathsToArchive
    );
    suffix = '.tar.gz';
    localPath = archivePath;
  }
  const artifactName = `build-${Date.now()}${suffix}`;
  const destPath = config.artifactPath ?? path.join(config.artifactsDir, artifactName);
  await fs.copy(localPath, destPath);
  l?.info({ phase: 'PREPARE_ARTIFACTS' }, `Writing artifacts to ${destPath}`);
  return { filename: destPath };
}

function getCommonParentDir(path1: string, path2: string): string {
  const normalizedPath1 = path.normalize(path1);
  const normalizedPath2 = path.normalize(path2);
  let current = path.dirname(normalizedPath1);
  while (current !== '/') {
    if (normalizedPath2.startsWith(current)) {
      return current;
    }
    current = path.dirname(current);
  }
  return '/';
}
