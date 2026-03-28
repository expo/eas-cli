import downloadFile from '@expo/downloader';
import { mkdirp, mkdtemp, remove } from 'fs-extra';
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

  const createCtx = (env: Record<string, string | undefined> = {}): BuildContext =>
    ({
      logger: createMockLogger(),
      env,
    }) as unknown as BuildContext;

  beforeEach(() => {
    jest.mocked(remove).mockImplementation(async () => undefined as any);
    jest.mocked(mkdirp).mockImplementation(async () => undefined as any);
    jest.mocked(mkdtemp).mockImplementation(async () => '/tmp/precompiled-modules-test' as any);
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
      '/tmp/precompiled-modules-test/precompiled-modules-0.zip',
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
      '/tmp/precompiled-modules-test/precompiled-modules-0.zip',
      { retry: 3 }
    );
    expect(downloadFile).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-0.zip',
      '/tmp/precompiled-modules-test/precompiled-modules-0.zip',
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
      '/tmp/precompiled-modules-test/precompiled-modules-0.zip',
      { retry: 3 }
    );
    expect(downloadFile).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules-1.zip',
      '/tmp/precompiled-modules-test/precompiled-modules-1.zip',
      { retry: 3 }
    );
    expect(extract).toHaveBeenNthCalledWith(1, null, PRECOMPILED_MODULES_PATH);
    expect(extract).toHaveBeenNthCalledWith(2, null, PRECOMPILED_MODULES_PATH);
  });
});
