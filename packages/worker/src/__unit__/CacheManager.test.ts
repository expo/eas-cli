import GCS from '@expo/gcs';
import { vol } from 'memfs';
import fs from 'fs-extra';
import downloadFile from '@expo/downloader';
import { Cache, Platform } from '@expo/eas-build-job';

import { GCSCacheManager } from '../CacheManager';

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('@expo/gcs', () => {
  return {
    uploadWithSignedUrl: jest.fn(),
  };
});

jest.mock('@expo/downloader', () => {
  return jest.fn();
});
jest.mock('../config', () => ({
  buildCache: {
    gcsSignedUploadUrlForBuildCache: 'fakeurl',
    gcsSignedBuildCacheDownloadUrl: 'fakeUrl',
  },
}));
jest.mock('../sentry', () => ({
  handleError: jest.fn(),
}));

async function saveAndRestoreCacheAsync(
  setupBeforeSave: () => Promise<void> | void,
  setupBeforeRestore: () => Promise<void> | void,
  cacheConfig: Partial<Cache>
): Promise<void> {
  await setupBeforeSave();
  const manager = new GCSCacheManager();
  const mockCtx = {
    logger: { info: jest.fn(), error: console.error },
    workingdir: '/projectRoot',
    buildDirectory: '/projectRoot/build',
    job: {
      platform: Platform.ANDROID,
      projectRootDirectory: '.',
      cache: cacheConfig,
    },
  } as any;
  let tarReadStream: any;
  (GCS.uploadWithSignedUrl as jest.Mock).mockImplementation(async ({ srcGeneratorAsync }) => {
    const result = await srcGeneratorAsync();
    tarReadStream = result.stream;
    return result;
  });

  await manager.saveCache(mockCtx);
  const chunks = [];
  for await (const chunk of tarReadStream) {
    chunks.push(chunk);
  }
  const tarContent = Buffer.concat(chunks);
  vol.reset();
  await setupBeforeRestore();
  (downloadFile as jest.Mock).mockImplementation(async (_url, archivePath: string) => {
    await fs.mkdirp(mockCtx.workingdir);
    await fs.writeFile(archivePath, tarContent);
  });
  await manager.restoreCache(mockCtx);
}

describe(GCSCacheManager, () => {
  beforeEach(() => {
    vol.reset();
  });
  afterEach(() => {
    (GCS.uploadWithSignedUrl as jest.Mock).mockReset();
    (downloadFile as jest.Mock).mockReset();
  });
  test('save and restore for a single file', async () => {
    await saveAndRestoreCacheAsync(
      () => {
        vol.fromJSON({
          '/projectRoot/build/index.ts': 'index.ts',
        });
      },
      () => {},
      {
        paths: ['index.ts'],
      }
    );

    expect(vol.toJSON()).toStrictEqual({
      '/projectRoot/build/index.ts': 'index.ts',
      '/projectRoot/cache-restore.tar.gz': expect.anything(),
    });
  });
  test('save and restore for a single directory', async () => {
    await saveAndRestoreCacheAsync(
      () => {
        vol.fromJSON({
          '/projectRoot/build/src/index.ts': 'index.ts',
          '/projectRoot/build/src/main.ts': 'index.ts',
        });
      },
      () => {},
      {
        paths: ['src'],
      }
    );

    expect(vol.toJSON()).toStrictEqual({
      '/projectRoot/build/src/index.ts': 'index.ts',
      '/projectRoot/build/src/main.ts': 'index.ts',
      '/projectRoot/cache-restore.tar.gz': expect.anything(),
    });
  });
  test('save and restore for a single directory outside of the project structure', async () => {
    await saveAndRestoreCacheAsync(
      () => {
        vol.fromJSON({
          '/projectRoot/build/src/index.ts': 'index.ts',
          '/outsideProjectRoot/build/src/index.ts': 'index.ts',
        });
      },
      () => {},
      {
        paths: ['/outsideProjectRoot/build'],
      }
    );

    expect(vol.toJSON()).toStrictEqual({
      '/outsideProjectRoot/build/src/index.ts': 'index.ts',
      '/projectRoot/cache-restore.tar.gz': expect.anything(),
    });
  });
  test('that save and restore does not override existing files', async () => {
    await saveAndRestoreCacheAsync(
      () => {
        vol.fromJSON({
          '/projectRoot/build/src/index.ts': 'index.ts',
          '/projectRoot/build/src/main': 'index.ts',
        });
      },
      () => {
        vol.fromJSON({
          '/projectRoot/build/src/index.ts': 'index2.ts',
        });
      },
      {
        paths: ['src'],
      }
    );

    expect(vol.toJSON()).toStrictEqual({
      '/projectRoot/build/src/index.ts': 'index2.ts',
      '/projectRoot/build/src/main': 'index.ts',
      '/projectRoot/cache-restore.tar.gz': expect.anything(),
    });
  });
  test('save and restore for multiple locations', async () => {
    await saveAndRestoreCacheAsync(
      () => {
        vol.fromJSON({
          '/projectRoot/build/src/index.ts': 'index.ts',
          '/outsideProjectRoot/build/src/index.ts': 'index.ts',
        });
      },
      () => {},
      {
        paths: ['src', '/outsideProjectRoot/build'],
      }
    );

    expect(vol.toJSON()).toStrictEqual({
      '/outsideProjectRoot/build/src/index.ts': 'index.ts',
      '/projectRoot/build/src/index.ts': 'index.ts',
      '/projectRoot/cache-restore.tar.gz': expect.anything(),
    });
  });
});
