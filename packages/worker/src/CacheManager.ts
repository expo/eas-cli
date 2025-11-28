import path from 'path';

import GCS from '@expo/gcs';
import filesize from 'filesize';
import downloadFile from '@expo/downloader';
import { BuildJob } from '@expo/eas-build-job';
import { CacheManager, BuildContext } from '@expo/build-tools';
import fs from 'fs-extra';
import tar from 'tar';

import config from './config';

type ContentLengthRange = { minSizeBytes: number; maxSizeBytes: number };

export class GCSCacheManager implements CacheManager {
  private skipCacheUpdate = false;

  public async saveCache(ctx: BuildContext<BuildJob>): Promise<void> {
    if (this.skipCacheUpdate) {
      return;
    }
    const paths = this.getPaths(ctx);
    if (
      (ctx.job?.cache?.disabled ?? false) ||
      !config.buildCache.gcsSignedUploadUrlForBuildCache ||
      paths.length === 0
    ) {
      return;
    }

    ctx.logger.info('Saving to cache:');
    paths.forEach((filePath) => {
      ctx.logger.info(`- ${filePath}`);
    });
    const archivePath = path.join(ctx.workingdir, 'cache-save.tar.gz');
    await tar.create(
      {
        file: archivePath,
        cwd: '/',
        gzip: true,
        preservePaths: true,
      },
      paths
    );

    const archiveSize = (await fs.stat(archivePath)).size;
    const { maxSizeBytes } = this.allowedContentLengthRange;
    const friendlyMaxSize = filesize(maxSizeBytes);
    const friendlyArchiveSize = filesize(archiveSize);

    if (archiveSize > maxSizeBytes) {
      ctx.logger.error(
        `Unable to save cache. Max size is ${friendlyMaxSize} but archive size is ${friendlyArchiveSize}.`
      );
      return;
    }

    try {
      await GCS.uploadWithSignedUrl({
        signedUrl: config.buildCache.gcsSignedUploadUrlForBuildCache,
        srcGeneratorAsync: async () => {
          return {
            stream: fs.createReadStream(archivePath),
          };
        },
      });
    } catch (err: any) {
      ctx.logger.error({ err });
    }
  }

  public async restoreCache(ctx: BuildContext<BuildJob>): Promise<void> {
    const paths = this.getPaths(ctx);
    if (
      (ctx.job?.cache?.disabled ?? false) ||
      !config.buildCache.gcsSignedBuildCacheDownloadUrl ||
      paths.length === 0
    ) {
      return;
    }
    ctx.logger.info('Restoring files from cache:');
    paths.forEach((filePath) => {
      ctx.logger.info(`- ${filePath}`);
    });

    const archivePath = path.join(ctx.workingdir, 'cache-restore.tar.gz');
    try {
      await downloadFile(config.buildCache.gcsSignedBuildCacheDownloadUrl, archivePath, {});
    } catch (err: any) {
      ctx.logger.error({ err });
      this.skipCacheUpdate = true; // if restore failed we don't want to update cache with new values
      return;
    }
    // @ts-expect-error
    await tar.extract(
      {
        file: archivePath,
        cwd: '/',
        preserveOwner: true,
        preservePaths: true,
        keep: true, // do not override existing files
      },
      paths
    );
  }

  private getPaths(ctx: BuildContext<BuildJob>): string[] {
    const paths = ctx.job.cache?.paths ?? [];
    return paths.map((cachePath) =>
      path.isAbsolute(cachePath)
        ? cachePath
        : path.resolve(ctx.buildDirectory, ctx.job.projectRootDirectory ?? '.', cachePath)
    );
  }

  private get allowedContentLengthRange(): ContentLengthRange {
    const headers = config.buildCache.gcsSignedUploadUrlForBuildCache?.headers;
    const defaultValues = { minSizeBytes: -Infinity, maxSizeBytes: Infinity };

    if (!headers) {
      return defaultValues;
    }

    const values = headers['x-goog-content-length-range'];
    if (!values) {
      return defaultValues;
    }

    const [min, max] = values.split(',');
    return {
      minSizeBytes: Number(min),
      maxSizeBytes: Number(max),
    };
  }
}
