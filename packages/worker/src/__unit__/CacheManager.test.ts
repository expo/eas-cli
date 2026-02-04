import { GCS } from '@expo/build-tools';
import downloadFile from '@expo/downloader';
import { Cache, Platform } from '@expo/eas-build-job';
import { randomUUID } from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('fs-extra');
jest.unmock('node:fs');
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

const { GCSCacheManager } = require('../CacheManager');

describe(GCSCacheManager, () => {
  let tmpDir: string;
  let outsideDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-test-'));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cli-outside-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    jest.mocked(GCS.uploadWithSignedUrl).mockReset();
    jest.mocked(downloadFile).mockReset();
  });

  async function saveAndRestoreCacheAsync(
    setupBeforeSave: () => Promise<void> | void,
    setupBeforeRestore: () => Promise<void> | void,
    cacheConfig: Partial<Cache>
  ): Promise<void> {
    await setupBeforeSave();
    const manager = new GCSCacheManager();
    const mockCtx = {
      logger: { info: jest.fn(), error: console.error },
      workingdir: tmpDir,
      buildDirectory: `${tmpDir}/build`,
      job: {
        platform: Platform.ANDROID,
        projectRootDirectory: '.',
        cache: cacheConfig,
      },
    } as any;
    let tarReadStream: Readable;
    jest.mocked(GCS.uploadWithSignedUrl).mockImplementation(async ({ srcGeneratorAsync }) => {
      const result = await srcGeneratorAsync();
      tarReadStream = result;
      return randomUUID();
    });

    await manager.saveCache(mockCtx);
    const chunks = [];
    for await (const chunk of tarReadStream!) {
      chunks.push(chunk);
    }
    const tarContent = Buffer.concat(chunks);
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    await setupBeforeRestore();
    jest.mocked(downloadFile).mockImplementation(async (_url, archivePath: string) => {
      await fs.mkdirp(mockCtx.workingdir);
      await fs.writeFile(archivePath, tarContent);
    });
    await manager.restoreCache(mockCtx);
  }

  test('save and restore for a single file', async () => {
    await saveAndRestoreCacheAsync(
      () => {
        return fs.outputFile(path.join(tmpDir, 'build', 'index.ts'), 'index.ts');
      },
      () => {},
      {
        paths: ['index.ts'],
      }
    );

    await expect(fs.readFile(path.join(tmpDir, 'build', 'index.ts'), 'utf8')).resolves.toBe(
      'index.ts'
    );
    await expect(fs.pathExists(path.join(tmpDir, 'cache-restore.tar.gz'))).resolves.toBe(true);
  });
  test('save and restore for a single directory', async () => {
    await saveAndRestoreCacheAsync(
      async () => {
        await Promise.all([
          fs.outputFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'index.ts'),
          fs.outputFile(path.join(tmpDir, 'build', 'src', 'main.ts'), 'index.ts'),
        ]);
      },
      () => {},
      {
        paths: ['src'],
      }
    );

    await expect(fs.readFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'index.ts'
    );
    await expect(fs.readFile(path.join(tmpDir, 'build', 'src', 'main.ts'), 'utf8')).resolves.toBe(
      'index.ts'
    );
    await expect(fs.pathExists(path.join(tmpDir, 'cache-restore.tar.gz'))).resolves.toBe(true);
  });
  test('save and restore for a single directory outside of the project structure', async () => {
    await saveAndRestoreCacheAsync(
      async () => {
        await Promise.all([
          fs.outputFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'index.ts'),
          fs.outputFile(path.join(outsideDir, 'build', 'src', 'index.ts'), 'index.ts'),
        ]);
      },
      () => {},
      {
        paths: [path.join(outsideDir, 'build')],
      }
    );

    await expect(
      fs.readFile(path.join(outsideDir, 'build', 'src', 'index.ts'), 'utf8')
    ).resolves.toBe('index.ts');
    await expect(fs.pathExists(path.join(tmpDir, 'build', 'src', 'index.ts'))).resolves.toBe(false);
    await expect(fs.pathExists(path.join(tmpDir, 'cache-restore.tar.gz'))).resolves.toBe(true);
  });
  test('that save and restore does not override existing files', async () => {
    await saveAndRestoreCacheAsync(
      async () => {
        await Promise.all([
          fs.outputFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'index.ts'),
          fs.outputFile(path.join(tmpDir, 'build', 'src', 'main'), 'index.ts'),
        ]);
      },
      () => {
        return fs.outputFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'index2.ts');
      },
      {
        paths: ['src'],
      }
    );

    await expect(fs.readFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'index2.ts'
    );
    await expect(fs.readFile(path.join(tmpDir, 'build', 'src', 'main'), 'utf8')).resolves.toBe(
      'index.ts'
    );
    await expect(fs.pathExists(path.join(tmpDir, 'cache-restore.tar.gz'))).resolves.toBe(true);
  });
  test('save and restore for multiple locations', async () => {
    await saveAndRestoreCacheAsync(
      async () => {
        await Promise.all([
          fs.outputFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'index.ts'),
          fs.outputFile(path.join(outsideDir, 'build', 'src', 'index.ts'), 'index.ts'),
        ]);
      },
      () => {},
      {
        paths: ['src', path.join(outsideDir, 'build')],
      }
    );

    await expect(fs.readFile(path.join(tmpDir, 'build', 'src', 'index.ts'), 'utf8')).resolves.toBe(
      'index.ts'
    );
    await expect(
      fs.readFile(path.join(outsideDir, 'build', 'src', 'index.ts'), 'utf8')
    ).resolves.toBe('index.ts');
    await expect(fs.pathExists(path.join(tmpDir, 'cache-restore.tar.gz'))).resolves.toBe(true);
  });
});
