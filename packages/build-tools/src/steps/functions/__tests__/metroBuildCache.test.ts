import { Platform } from '@expo/eas-build-job';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as tar from 'tar';

import { createGlobalContextMock } from '../../../__tests__/utils/context';
import { createMockLogger } from '../../../__tests__/utils/logger';
import { restoreMetroCacheAsync, saveMetroCacheAsync } from '../metroBuildCache';
import { createRestoreBuildCacheFunction } from '../restoreBuildCache';
import { downloadCacheAsync } from '../restoreCache';
import { createSaveBuildCacheFunction } from '../saveBuildCache';
import { uploadCacheAsync } from '../saveCache';

jest.mock('../restoreCache', () => ({ downloadCacheAsync: jest.fn() }));
jest.mock('../saveCache', () => ({ uploadCacheAsync: jest.fn() }));

const logger = createMockLogger();
const options = {
  logger,
  platform: Platform.IOS,
  env: {
    EAS_METRO_CACHE: '1',
    EAS_BUILD_ID: 'build-id',
    __API_SERVER_URL: 'https://api.expo.test',
  },
  secrets: { robotAccessToken: 'token' },
};

async function writeEntry(root: string, name: string, value: string): Promise<void> {
  const filename = path.join(root, name);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, value);
}

describe('Metro build cache', () => {
  let root: string;
  beforeEach(async () => {
    jest.resetAllMocks();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'metro-test-'));
    jest.mocked(downloadCacheAsync).mockRejectedValue(new Error('cache miss'));
  });

  it('does nothing unless enabled', async () => {
    expect(await restoreMetroCacheAsync({ ...options, env: {}, cacheDirectory: root })).toEqual({});
    await saveMetroCacheAsync({ ...options, env: {} });
    expect(downloadCacheAsync).not.toHaveBeenCalled();
    expect(uploadCacheAsync).not.toHaveBeenCalled();
  });

  it('starts with empty stores after a miss and preserves them on repeated restore steps', async () => {
    await writeEntry(path.join(root, 'output'), 'aa/bb.mp', 'old output');
    await writeEntry(path.join(root, 'restored'), 'aa/cc.mp', 'old restored');
    const cacheEnv = await restoreMetroCacheAsync({ ...options, cacheDirectory: root });
    expect(await fs.readdir(cacheEnv.EAS_METRO_CACHE_OUTPUT_DIR)).toEqual([]);
    expect(await fs.readdir(cacheEnv.EAS_METRO_CACHE_RESTORE_DIR)).toEqual([]);
    await writeEntry(cacheEnv.EAS_METRO_CACHE_OUTPUT_DIR, 'aa/bb.mp', 'first bundle');
    await restoreMetroCacheAsync({
      ...options,
      env: { ...options.env, ...cacheEnv },
      cacheDirectory: root,
    });
    expect(await fs.readFile(path.join(root, 'output/aa/bb.mp'), 'utf8')).toBe('first bundle');
    expect(downloadCacheAsync).toHaveBeenCalledTimes(1);
  });

  it('archives only completed output entries and restores into a different job directory', async () => {
    const cacheEnv = await restoreMetroCacheAsync({ ...options, cacheDirectory: root });
    await writeEntry(cacheEnv.EAS_METRO_CACHE_OUTPUT_DIR, 'aa/bb.mp', 'reused');
    await writeEntry(cacheEnv.EAS_METRO_CACHE_OUTPUT_DIR, 'aa/cc.mp', 'new');
    await writeEntry(cacheEnv.EAS_METRO_CACHE_OUTPUT_DIR, 'aa/bb.tmp123.mp', 'incomplete');
    await writeEntry(cacheEnv.EAS_METRO_CACHE_RESTORE_DIR, 'aa/dd.mp', 'unused');
    const downloadPath = path.join(os.tmpdir(), 'download.tar.gz');
    jest.mocked(uploadCacheAsync).mockImplementation(async ({ archivePath }) => {
      await fs.copyFile(archivePath, downloadPath);
    });
    await saveMetroCacheAsync({ ...options, env: { ...options.env, ...cacheEnv } });
    expect(uploadCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'ios-metro-transform-v1',
        force: true,
        paths: ['metro-transform-cache-v1'],
      })
    );
    const archivePath = downloadPath;
    jest
      .mocked(downloadCacheAsync)
      .mockResolvedValue({ archivePath, matchedKey: 'ios-metro-transform-v1' });
    const next = await restoreMetroCacheAsync({
      ...options,
      cacheDirectory: path.join(root, 'next-job'),
    });
    expect(await fs.readdir(path.join(next.EAS_METRO_CACHE_RESTORE_DIR, 'aa'))).toEqual([
      'bb.mp',
      'cc.mp',
    ]);
    expect(await fs.readFile(path.join(next.EAS_METRO_CACHE_RESTORE_DIR, 'aa/bb.mp'), 'utf8')).toBe(
      'reused'
    );
    expect(await fs.readdir(next.EAS_METRO_CACHE_OUTPUT_DIR)).toEqual([]);
    expect(downloadCacheAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: 'ios-metro-transform-v1',
        paths: ['metro-transform-cache-v1'],
      })
    );
  });

  it('ignores archives with no usable entries and skips empty output from older Metro versions', async () => {
    const source = path.join(root, 'source');
    await writeEntry(source, 'other.txt', 'not a cache');
    const archivePath = path.join(root, 'download.tar.gz');
    await tar.create({ file: archivePath, cwd: source, gzip: true }, ['other.txt']);
    jest.mocked(downloadCacheAsync).mockResolvedValue({ archivePath, matchedKey: 'key' });
    const cacheEnv = await restoreMetroCacheAsync({
      ...options,
      cacheDirectory: path.join(root, 'cache'),
    });
    expect(await fs.readdir(cacheEnv.EAS_METRO_CACHE_RESTORE_DIR)).toEqual([]);
    await saveMetroCacheAsync({ ...options, env: { ...options.env, ...cacheEnv } });
    expect(uploadCacheAsync).not.toHaveBeenCalled();
  });

  it('discards a damaged archive and still allows a cold bundle', async () => {
    const archivePath = path.join(root, 'broken.tar.gz');
    await fs.writeFile(archivePath, 'not a tar archive');
    jest.mocked(downloadCacheAsync).mockResolvedValue({ archivePath, matchedKey: 'key' });
    const cacheEnv = await restoreMetroCacheAsync({
      ...options,
      cacheDirectory: path.join(root, 'cache'),
    });
    expect(await fs.readdir(cacheEnv.EAS_METRO_CACHE_RESTORE_DIR)).toEqual([]);
    expect(await fs.readdir(cacheEnv.EAS_METRO_CACHE_OUTPUT_DIR)).toEqual([]);
  });

  it('passes cache directories from the restore step to later steps', async () => {
    const globalCtx = createGlobalContextMock({
      logger,
      projectTargetDirectory: root,
      staticContextContent: { job: { platform: Platform.IOS, secrets: options.secrets } },
    });
    globalCtx.updateEnv({ ...options.env, PRESERVED_ENV: 'value' });
    const restoreStep = createRestoreBuildCacheFunction().createBuildStepFromFunctionCall(
      globalCtx,
      {}
    );
    await restoreStep.executeAsync();
    expect(globalCtx.env.PRESERVED_ENV).toBe('value');
    const output = globalCtx.env.EAS_METRO_CACHE_OUTPUT_DIR!;
    expect(path.isAbsolute(output)).toBe(true);
    expect(globalCtx.env.EAS_METRO_CACHE_RESTORE_DIR).not.toBe(output);
    await writeEntry(output, 'aa/bb.mp', 'bundle result');
    const saveStep = createSaveBuildCacheFunction(new Date()).createBuildStepFromFunctionCall(
      globalCtx,
      {}
    );
    await saveStep.executeAsync();
    expect(uploadCacheAsync).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('does not fail the build if upload fails', async () => {
    const cacheEnv = await restoreMetroCacheAsync({ ...options, cacheDirectory: root });
    await writeEntry(cacheEnv.EAS_METRO_CACHE_OUTPUT_DIR, 'aa/bb.mp', 'new');
    jest.mocked(uploadCacheAsync).mockRejectedValue(new Error('network failure'));
    await expect(
      saveMetroCacheAsync({ ...options, env: { ...options.env, ...cacheEnv } })
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, 'cache.tar.gz'))).rejects.toThrow();
  });
});
