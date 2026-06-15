import { BuildContext, CacheManager } from '@expo/build-tools';
import { downloadCacheAsync } from '@expo/build-tools/dist/steps/functions/restoreCache';
import { uploadCacheAsync } from '@expo/build-tools/dist/steps/functions/saveCache';
import { BuildJob } from '@expo/eas-build-job';
import crypto from 'crypto';
import fs from 'fs-extra';
import stringify from 'json-stable-stringify';
import nullthrows from 'nullthrows';
import path from 'path';
import * as tar from 'tar';

export class GCSCacheManager implements CacheManager {
  private skipCacheUpdate = false;

  public async saveCache(ctx: BuildContext<BuildJob>): Promise<void> {
    if (this.skipCacheUpdate) {
      return;
    }
    const paths = this.getPaths(ctx);
    if ((ctx.job?.cache?.disabled ?? false) || paths.length === 0) {
      return;
    }

    ctx.logger.info('Saving to cache:');
    paths.forEach(filePath => {
      ctx.logger.info(`- ${filePath}`);
    });
    const archivePath = path.join(ctx.workingdir, 'cache-save.tar.gz');
    try {
      await tar.create(
        {
          file: archivePath,
          cwd: '/',
          gzip: true,
          preservePaths: true,
        },
        paths
      );
    } catch (err: any) {
      ctx.logger.error({ err }, 'Failed to create cache archive');
      return;
    }

    const archiveSize = (await fs.stat(archivePath)).size;

    try {
      await uploadCacheAsync({
        logger: ctx.logger,
        jobId: nullthrows(ctx.env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set'),
        expoApiServerURL: nullthrows(ctx.env.__API_SERVER_URL, '__API_SERVER_URL is not set'),
        robotAccessToken: nullthrows(
          ctx.job.secrets?.robotAccessToken,
          'Robot access token is required for cache operations'
        ),
        paths,
        key: this.getCacheKey(ctx),
        archivePath,
        size: archiveSize,
        platform: ctx.job.platform,
        force: ctx.job.cache?.clear,
      });
    } catch (err: any) {
      ctx.logger.error({ err });
    }
  }

  public async restoreCache(ctx: BuildContext<BuildJob>): Promise<void> {
    const paths = this.getPaths(ctx);
    if ((ctx.job?.cache?.disabled ?? false) || paths.length === 0) {
      return;
    }

    if (ctx.job.cache?.clear) {
      // Skip restore; saveCache will force upload the new archive for this key.
      return;
    }

    const archivePath = path.join(ctx.workingdir, 'cache-restore.tar.gz');
    try {
      const { archivePath: downloadedArchivePath } = await downloadCacheAsync({
        logger: ctx.logger,
        jobId: nullthrows(ctx.env.EAS_BUILD_ID, 'EAS_BUILD_ID is not set'),
        expoApiServerURL: nullthrows(ctx.env.__API_SERVER_URL, '__API_SERVER_URL is not set'),
        robotAccessToken: nullthrows(
          ctx.job.secrets?.robotAccessToken,
          'Robot access token is required for cache operations'
        ),
        paths,
        key: this.getCacheKey(ctx),
        keyPrefixes: [],
        platform: ctx.job.platform,
      });
      await fs.copy(downloadedArchivePath, archivePath);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        ctx.logger.info('No cache found for this key');
      } else {
        ctx.logger.error({ err });
      }
      this.skipCacheUpdate = true; // if restore failed we don't want to update cache with new values
      return;
    }

    ctx.logger.info('Restoring files from cache:');
    paths.forEach(filePath => {
      ctx.logger.info(`- ${filePath}`);
    });

    try {
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
    } catch (err: any) {
      ctx.logger.error({ err }, 'Failed to extract cache archive');
      this.skipCacheUpdate = true;
    }
  }

  private getPaths(ctx: BuildContext<BuildJob>): string[] {
    const paths = ctx.job.cache?.paths ?? [];
    return paths.map(cachePath =>
      path.isAbsolute(cachePath)
        ? cachePath
        : path.resolve(ctx.buildDirectory, ctx.job.projectRootDirectory ?? '.', cachePath)
    );
  }

  private getCacheKey(ctx: BuildContext<BuildJob>): string {
    const cacheForKey = { ...(ctx.job.cache ?? {}) };
    delete cacheForKey.clear;
    const keySource = {
      cache: cacheForKey,
      workflow: ctx.job.type,
      sdkVersion: ctx.metadata?.sdkVersion ?? '',
    };
    const base64CacheConfig = Buffer.from(
      nullthrows(stringify(keySource), 'Failed to stringify cache key source')
    ).toString('base64');
    const hash = crypto.createHash('sha256').update(base64CacheConfig).digest('hex');
    return `eas-build-cache-${hash}`;
  }
}
