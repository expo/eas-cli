import downloadFile from '@expo/downloader';
import { mkdirp, mkdtemp, moveSync, remove, removeSync } from 'fs-extra';
import StreamZip from 'node-stream-zip';

import {
  PRECOMPILED_MODULES_PATH,
  startPreparingPrecompiledDependencies,
  waitForPrecompiledModulesPreparationAsync,
} from '../precompiledModules';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';

jest.mock('@expo/downloader');
jest.mock('fs-extra');
jest.mock('node-stream-zip', () => ({
  __esModule: true,
  default: {
    async: jest.fn(),
  },
}));

describe('precompiledModules', () => {
  const extract = jest.fn();
  const close = jest.fn();
  const getMkdtempPath = jest.fn();

  const createCtx = (env: Record<string, string | undefined> = {}): BuildContext =>
    ({
      logger: createMockLogger(),
      env,
    }) as unknown as BuildContext;

  beforeEach(() => {
    jest.mocked(remove).mockImplementation(async () => undefined as any);
    jest.mocked(mkdirp).mockImplementation(async () => undefined as any);
    jest.mocked(removeSync).mockImplementation(() => undefined as any);
    jest.mocked(moveSync).mockImplementation(() => undefined as any);
    getMkdtempPath.mockReset();
    getMkdtempPath
      .mockReturnValueOnce('/tmp/precompiled-modules-archive')
      .mockReturnValueOnce('/tmp/precompiled-modules-staging');
    jest.mocked(mkdtemp).mockImplementation(async () => getMkdtempPath() as any);
    jest.mocked(downloadFile).mockReset();
    extract.mockReset().mockResolvedValue(undefined);
    close.mockReset().mockResolvedValue(undefined);
    jest.mocked(StreamZip.async).mockImplementation(
      () =>
        ({
          extract,
          close,
        }) as any
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('downloads through CocoaPods proxy when enabled', async () => {
    jest.mocked(downloadFile).mockResolvedValue(undefined);

    startPreparingPrecompiledDependencies(
      createCtx({ EAS_BUILD_COCOAPODS_CACHE_URL: 'http://localhost:9001' }),
      [
        'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      ]
    );

    await waitForPrecompiledModulesPreparationAsync();

    expect(downloadFile).toHaveBeenCalledWith(
      'http://localhost:9001/storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      '/tmp/precompiled-modules-archive/precompiled-modules-0.zip',
      { retry: 3 }
    );
  });

  it('falls back to the direct url when CocoaPods proxy download fails', async () => {
    jest
      .mocked(downloadFile)
      .mockRejectedValueOnce(new Error('proxy failed'))
      .mockResolvedValueOnce(undefined);

    startPreparingPrecompiledDependencies(
      createCtx({ EAS_BUILD_COCOAPODS_CACHE_URL: 'http://localhost:9001' }),
      [
        'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      ]
    );

    await waitForPrecompiledModulesPreparationAsync();

    expect(downloadFile).toHaveBeenNthCalledWith(
      1,
      'http://localhost:9001/storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      '/tmp/precompiled-modules-archive/precompiled-modules-0.zip',
      { retry: 3 }
    );
    expect(downloadFile).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      '/tmp/precompiled-modules-archive/precompiled-modules-0.zip',
      { retry: 3 }
    );
  });

  it('extracts all configured archives into the well-known destination path', async () => {
    jest.mocked(downloadFile).mockResolvedValue(undefined);

    startPreparingPrecompiledDependencies(createCtx(), [
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-1.zip',
    ]);

    await waitForPrecompiledModulesPreparationAsync();

    expect(mkdirp).toHaveBeenCalledWith(PRECOMPILED_MODULES_PATH);
    expect(downloadFile).toHaveBeenNthCalledWith(
      1,
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      '/tmp/precompiled-modules-archive/precompiled-modules-0.zip',
      { retry: 3 }
    );
    expect(downloadFile).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-1.zip',
      '/tmp/precompiled-modules-archive/precompiled-modules-1.zip',
      { retry: 3 }
    );
    expect(extract).toHaveBeenNthCalledWith(1, null, '/tmp/precompiled-modules-staging');
    expect(extract).toHaveBeenNthCalledWith(2, null, '/tmp/precompiled-modules-staging');
    expect(moveSync).toHaveBeenCalledWith(
      '/tmp/precompiled-modules-staging',
      PRECOMPILED_MODULES_PATH
    );
  });

  it('leaves the destination empty when preparation fails', async () => {
    jest.mocked(downloadFile).mockResolvedValue(undefined);
    extract.mockRejectedValueOnce(new Error('extract failed'));

    const ctx = createCtx();
    startPreparingPrecompiledDependencies(ctx, [
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
    ]);

    await expect(waitForPrecompiledModulesPreparationAsync()).rejects.toThrow('extract failed');

    expect(ctx.logger.error).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Failed to prepare precompiled dependencies'
    );
    expect(moveSync).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('/tmp/precompiled-modules-staging');
    expect(remove).toHaveBeenCalledWith(PRECOMPILED_MODULES_PATH);
    expect(mkdirp).toHaveBeenCalledWith(PRECOMPILED_MODULES_PATH);
  });

  it('logs background failures even if nobody waits for preparation', async () => {
    jest.mocked(downloadFile).mockRejectedValue(new Error('download failed'));
    const ctx = createCtx();

    startPreparingPrecompiledDependencies(ctx, ['https://example.com/xcframeworks-Debug.zip']);

    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));

    expect(ctx.logger.error).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Failed to prepare precompiled dependencies'
    );
    await expect(waitForPrecompiledModulesPreparationAsync()).rejects.toThrow('download failed');
  });

  it('throws when precompiled dependencies are still not ready after 15 seconds', async () => {
    jest.useFakeTimers();
    jest.mocked(downloadFile).mockImplementation(() => new Promise<void>(() => undefined) as any);
    const ctx = createCtx();

    startPreparingPrecompiledDependencies(ctx, ['https://example.com/xcframeworks-Debug.zip']);

    const waitPromise = waitForPrecompiledModulesPreparationAsync();
    const waitExpectation = expect(waitPromise).rejects.toThrow(
      'Timed out waiting for precompiled dependencies after 15 seconds'
    );

    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(15_000);
    await waitExpectation;
    expect(moveSync).not.toHaveBeenCalled();
  });

  it('does not publish staged modules after timing out', async () => {
    jest.useFakeTimers();
    jest.mocked(downloadFile).mockResolvedValue(undefined);
    let finishExtraction!: () => void;
    extract.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishExtraction = resolve;
        })
    );
    const ctx = createCtx();

    startPreparingPrecompiledDependencies(ctx, ['https://example.com/xcframeworks-Debug.zip']);

    const waitPromise = waitForPrecompiledModulesPreparationAsync();
    const waitExpectation = expect(waitPromise).rejects.toThrow(
      'Timed out waiting for precompiled dependencies after 15 seconds'
    );

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(15_000);
    await waitExpectation;

    finishExtraction();
    await Promise.resolve();
    await Promise.resolve();

    expect(moveSync).not.toHaveBeenCalled();
  });
});
