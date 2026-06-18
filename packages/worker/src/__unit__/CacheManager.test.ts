import { downloadCacheAsync } from '@expo/build-tools/dist/steps/functions/restoreCache';
import { uploadCacheAsync } from '@expo/build-tools/dist/steps/functions/saveCache';
import { Cache, Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

// These tests use real fs and directories in os.tmpdir().
// Something about tar v7 makes mocking fs with memfs problematic.
// Mocking all variants of fs/node:fs/fs/promises does not help.
// Last Codex research indicated it might be something related to fs-minipass
// and fs.writev, mocking fs.writev did not help though.
jest.unmock('fs');
jest.unmock('node:fs');

jest.mock('../sentry', () => ({
  capture: jest.fn(),
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
    jest.mocked(uploadCacheAsync).mockReset();
    jest.mocked(downloadCacheAsync).mockReset();
  });

  function createMockCtx(cacheConfig: Partial<Cache>) {
    return {
      logger: { info: jest.fn(), error: jest.fn() },
      workingdir: tmpDir,
      buildDirectory: `${tmpDir}/build`,
      env: {
        EAS_BUILD_ID: 'build-id',
        __API_SERVER_URL: 'https://api.expo.test',
      },
      metadata: {
        sdkVersion: '55.0.0',
      },
      job: {
        platform: Platform.ANDROID,
        type: Workflow.GENERIC,
        projectRootDirectory: '.',
        cache: cacheConfig,
        secrets: {
          robotAccessToken: 'robot-token',
        },
      },
    } as any;
  }

  async function saveAndRestoreCacheAsync(
    setupBeforeSave: () => Promise<void> | void,
    setupBeforeRestore: () => Promise<void> | void,
    cacheConfig: Partial<Cache>
  ): Promise<void> {
    await setupBeforeSave();
    const manager = new GCSCacheManager();
    const mockCtx = createMockCtx(cacheConfig);
    let tarContent: Buffer | undefined;
    jest.mocked(uploadCacheAsync).mockImplementation(async ({ archivePath }) => {
      tarContent = await fs.readFile(archivePath);
    });

    await manager.saveCache(mockCtx);
    if (!tarContent) {
      throw new Error('Expected cache archive to be uploaded');
    }
    const uploadedTarContent = tarContent;

    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
    await setupBeforeRestore();
    jest.mocked(downloadCacheAsync).mockImplementation(async () => {
      const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eas-cache-download-'));
      const archivePath = path.join(downloadDir, 'cache.tar.gz');
      await fs.writeFile(archivePath, uploadedTarContent);
      return { archivePath, matchedKey: 'matched-cache-key' };
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

  test('does not save or restore when cache is disabled', async () => {
    const manager = new GCSCacheManager();
    const mockCtx = createMockCtx({ disabled: true, paths: ['index.ts'] });
    await fs.outputFile(path.join(tmpDir, 'build', 'index.ts'), 'index.ts');

    await manager.restoreCache(mockCtx);
    await manager.saveCache(mockCtx);

    expect(downloadCacheAsync).not.toHaveBeenCalled();
    expect(uploadCacheAsync).not.toHaveBeenCalled();
  });

  test('does not save or restore when cache paths are empty', async () => {
    const manager = new GCSCacheManager();
    const mockCtx = createMockCtx({ paths: [] });

    await manager.restoreCache(mockCtx);
    await manager.saveCache(mockCtx);

    expect(downloadCacheAsync).not.toHaveBeenCalled();
    expect(uploadCacheAsync).not.toHaveBeenCalled();
  });

  test('skips restore but saves cache when clear is set', async () => {
    const manager = new GCSCacheManager();
    const mockCtx = createMockCtx({ clear: true, paths: ['index.ts'] });
    await fs.outputFile(path.join(tmpDir, 'build', 'index.ts'), 'index.ts');
    jest.mocked(uploadCacheAsync).mockResolvedValue();

    await manager.restoreCache(mockCtx);
    await manager.saveCache(mockCtx);

    expect(downloadCacheAsync).not.toHaveBeenCalled();
    expect(uploadCacheAsync).toHaveBeenCalledTimes(1);
    expect(uploadCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
      })
    );
  });

  test('does not save when restore fails', async () => {
    const manager = new GCSCacheManager();
    const mockCtx = createMockCtx({ paths: ['index.ts'] });
    await fs.outputFile(path.join(tmpDir, 'build', 'index.ts'), 'index.ts');
    jest.mocked(downloadCacheAsync).mockRejectedValue({ response: { status: 404 } });

    await manager.restoreCache(mockCtx);
    await manager.saveCache(mockCtx);

    expect(mockCtx.logger.info).toHaveBeenCalledWith('No cache found for this key');
    expect(uploadCacheAsync).not.toHaveBeenCalled();
  });

  test('cache key is stable when clear changes and job cache is not mutated', async () => {
    const manager = new GCSCacheManager();
    const cacheConfig = {
      clear: true,
      disabled: false,
      key: 'custom-cache-key',
      paths: ['index.ts'],
    };
    const mockCtx = createMockCtx(cacheConfig);
    await fs.outputFile(path.join(tmpDir, 'build', 'index.ts'), 'index.ts');
    jest.mocked(uploadCacheAsync).mockResolvedValue();

    await manager.saveCache(mockCtx);
    const keyWithClear = jest.mocked(uploadCacheAsync).mock.calls[0][0].key;
    const forceWithClear = jest.mocked(uploadCacheAsync).mock.calls[0][0].force;

    mockCtx.job.cache = { ...cacheConfig, clear: false };
    await manager.saveCache(mockCtx);
    const keyWithoutClear = jest.mocked(uploadCacheAsync).mock.calls[1][0].key;
    const forceWithoutClear = jest.mocked(uploadCacheAsync).mock.calls[1][0].force;

    expect(keyWithClear).toBe(keyWithoutClear);
    expect(keyWithClear).toMatch(/^eas-build-cache-[a-f0-9]{64}$/);
    expect(forceWithClear).toBe(true);
    expect(forceWithoutClear).toBe(false);
    expect(cacheConfig).toEqual({
      clear: true,
      disabled: false,
      key: 'custom-cache-key',
      paths: ['index.ts'],
    });
  });
});
