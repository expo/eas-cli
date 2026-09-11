import { type bunyan } from '@expo/logger';
import { Platform } from '@expo/eas-build-job';
import fs from 'fs';
import fetch from 'node-fetch';
import os from 'os';
import path from 'path';

import { compressCacheAsync, uploadCacheAsync } from '../saveCache';
import { decompressCacheAsync } from '../restoreCache';

jest.mock('node-fetch');

const { Response } = jest.requireActual('node-fetch') as typeof import('node-fetch');

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

describe(uploadCacheAsync, () => {
  afterEach(() => {
    jest.mocked(fetch).mockReset();
  });

  it.each([
    ['normal upload', undefined, false],
    ['forced upload', true, true],
  ] as const)('sends force for %s', async (_name, force, expectedForce) => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'upload-cache-test-'));
    const archivePath = path.join(tempDir, 'cache.tar.gz');
    await fs.promises.writeFile(archivePath, 'cache archive');

    jest
      .mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              headers: {},
              url: 'https://storage.expo.test/cache',
            },
          }),
          { status: 200 }
        )
      )
      .mockImplementationOnce(async (_url, request) => {
        const body = request!.body as NodeJS.ReadableStream & AsyncIterable<Buffer>;
        for await (const _chunk of body) {
          // Consume the archive stream as a real upload would.
        }
        return new Response(undefined, { status: 200 });
      });

    try {
      await uploadCacheAsync({
        logger: createLoggerMock(),
        jobId: 'build-id',
        expoApiServerURL: 'https://api.expo.test',
        robotAccessToken: 'robot-token',
        paths: ['/cache/path'],
        key: 'cache-key',
        archivePath,
        size: 13,
        platform: Platform.ANDROID,
        force,
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      const [uploadSessionUrl, uploadSessionRequest] = jest.mocked(fetch).mock.calls[0];
      expect(uploadSessionUrl.toString()).toBe(
        'https://api.expo.test/v2/turtle-builds/caches/upload-sessions'
      );
      expect(JSON.parse(uploadSessionRequest!.body as string)).toMatchObject({
        buildId: 'build-id',
        force: expectedForce,
        key: 'cache-key',
        size: 13,
      });
      expect(jest.mocked(fetch).mock.calls[1][0].toString()).toBe(
        'https://storage.expo.test/cache'
      );
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
