import { type bunyan } from '@expo/logger';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { compressCacheAsync } from '../saveCache';
import { decompressCacheAsync } from '../restoreCache';

function createLoggerMock(): bunyan {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as bunyan;
}

describe('cache compress/decompress round trip', () => {
  it('preserves multiple sibling directories archived together', async () => {
    const logger = createLoggerMock();

    const cachesDir = path.join(os.tmpdir(), 'gradle-caches');
    const buildCacheDir = path.join(cachesDir, 'build-cache-1');
    const journalDir = path.join(cachesDir, 'journal-1');
    await fs.promises.mkdir(buildCacheDir, { recursive: true });
    await fs.promises.mkdir(journalDir, { recursive: true });
    await fs.promises.writeFile(path.join(buildCacheDir, 'entry'), 'cache entry');
    await fs.promises.writeFile(path.join(journalDir, 'file-access.properties'), 'inception=1');

    const { archivePath } = await compressCacheAsync({
      paths: [buildCacheDir, journalDir],
      workingDirectory: cachesDir,
      verbose: false,
      logger,
    });

    const restoreDir = path.join(os.tmpdir(), 'gradle-caches-restored');
    await fs.promises.mkdir(restoreDir, { recursive: true });
    await decompressCacheAsync({
      archivePath,
      workingDirectory: restoreDir,
      verbose: false,
      logger,
    });

    expect(
      await fs.promises.readFile(path.join(restoreDir, 'build-cache-1', 'entry'), 'utf8')
    ).toBe('cache entry');
    expect(
      await fs.promises.readFile(
        path.join(restoreDir, 'journal-1', 'file-access.properties'),
        'utf8'
      )
    ).toBe('inception=1');
  });

  it('preserves file modification times so journal-fallback entries can still age out', async () => {
    const logger = createLoggerMock();

    const sourceDir = path.join(os.tmpdir(), 'mtime-source');
    await fs.promises.mkdir(sourceDir, { recursive: true });
    const filePath = path.join(sourceDir, 'entry');
    await fs.promises.writeFile(filePath, 'cache entry');

    // A whole-second value in the past — tar stores mtimes at one-second resolution.
    const mtime = new Date('2026-08-01T00:00:00.000Z');
    await fs.promises.utimes(filePath, mtime, mtime);

    const { archivePath } = await compressCacheAsync({
      paths: [sourceDir],
      workingDirectory: sourceDir,
      verbose: false,
      logger,
    });

    const restoreDir = path.join(os.tmpdir(), 'mtime-restored');
    await fs.promises.mkdir(restoreDir, { recursive: true });
    await decompressCacheAsync({
      archivePath,
      workingDirectory: restoreDir,
      verbose: false,
      logger,
    });

    const restoredStat = await fs.promises.stat(path.join(restoreDir, 'entry'));
    expect(Math.floor(restoredStat.mtimeMs / 1000)).toBe(Math.floor(mtime.getTime() / 1000));
  });
});
