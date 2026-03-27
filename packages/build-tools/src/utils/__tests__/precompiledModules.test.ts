import downloadFile from '@expo/downloader';
import { mkdirp, mkdtemp, remove } from 'fs-extra';
import * as tar from 'tar';

import {
  PRECOMPILED_MODULES_PATH,
  startPreparingPrecompiledDependencies,
  waitForPrecompiledModulesPreparationAsync,
} from '../precompiledModules';
import { createMockLogger } from '../../__tests__/utils/logger';
import { BuildContext } from '../../context';

jest.mock('@expo/downloader');
jest.mock('fs-extra');
jest.mock('tar');

describe('precompiledModules', () => {
  const createCtx = (env: Record<string, string | undefined> = {}): BuildContext =>
    ({
      logger: createMockLogger(),
      env,
    }) as unknown as BuildContext;

  beforeEach(() => {
    jest.mocked(remove).mockImplementation(async () => undefined as any);
    jest.mocked(mkdirp).mockImplementation(async () => undefined as any);
    jest.mocked(mkdtemp).mockImplementation(async () => '/tmp/precompiled-modules-test' as any);
    jest.mocked(tar.extract).mockResolvedValue(undefined);
    jest.mocked(downloadFile).mockReset();
  });

  it('downloads through CocoaPods proxy when enabled', async () => {
    jest.mocked(downloadFile).mockResolvedValue(undefined);

    startPreparingPrecompiledDependencies(
      createCtx({ EAS_BUILD_COCOAPODS_CACHE_URL: 'http://localhost:9001' }),
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules.tar.gz'
    );

    await waitForPrecompiledModulesPreparationAsync();

    expect(downloadFile).toHaveBeenCalledWith(
      'http://localhost:9001/storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules.tar.gz',
      '/tmp/precompiled-modules-test/precompiled-modules.tar.gz',
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
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules.tar.gz'
    );

    await waitForPrecompiledModulesPreparationAsync();

    expect(downloadFile).toHaveBeenNthCalledWith(
      1,
      'http://localhost:9001/storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules.tar.gz',
      '/tmp/precompiled-modules-test/precompiled-modules.tar.gz',
      { retry: 3 }
    );
    expect(downloadFile).toHaveBeenNthCalledWith(
      2,
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules.tar.gz',
      '/tmp/precompiled-modules-test/precompiled-modules.tar.gz',
      { retry: 3 }
    );
  });

  it('uses the well-known destination path', async () => {
    jest.mocked(downloadFile).mockResolvedValue(undefined);

    startPreparingPrecompiledDependencies(
      createCtx(),
      'https://storage.googleapis.com/eas-build-precompiled-modules-production/ios/precompiled-modules.tar.gz'
    );

    await waitForPrecompiledModulesPreparationAsync();

    expect(mkdirp).toHaveBeenCalledWith(PRECOMPILED_MODULES_PATH);
    expect(tar.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: PRECOMPILED_MODULES_PATH,
      })
    );
  });
});
