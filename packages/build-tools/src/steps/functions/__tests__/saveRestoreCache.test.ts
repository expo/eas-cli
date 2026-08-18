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
});
