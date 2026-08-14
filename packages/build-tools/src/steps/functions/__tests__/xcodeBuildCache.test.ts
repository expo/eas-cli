import { Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';

import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  XCODE_COMPILATION_CACHE_ENV,
  XCODE_COMPILATION_CACHE_RELATIVE_PATH,
  compressXcodeCompilationCacheAsync,
  decompressXcodeCompilationCacheAsync,
  generateXcodeCompilationCacheKeyAsync,
} from '../../../ios/compilationCache';
import { downloadCacheAsync } from '../restoreCache';
import { restoreXcodeCompilationCacheAsync } from '../restoreBuildCache';
import { uploadCacheAsync } from '../saveCache';
import { saveXcodeCompilationCacheAsync } from '../saveBuildCache';

jest.mock('../restoreCache', () => ({
  downloadCacheAsync: jest.fn(),
}));

jest.mock('../saveCache', () => ({
  uploadCacheAsync: jest.fn(),
}));

jest.mock('../../../ios/compilationCache', () => ({
  XCODE_COMPILATION_CACHE_ENV: 'EAS_BUILD_XCODE_COMPILATION_CACHE',
  XCODE_COMPILATION_CACHE_RELATIVE_PATH: 'ios/build/CompilationCache.noindex',
  compressXcodeCompilationCacheAsync: jest.fn(),
  decompressXcodeCompilationCacheAsync: jest.fn(),
  generateXcodeCompilationCacheKeyAsync: jest.fn(),
}));

const WORKING_DIRECTORY = '/working-directory';
const ENV = {
  [XCODE_COMPILATION_CACHE_ENV]: '1',
  EAS_USE_CACHE: '1',
  EAS_BUILD_ID: 'build-id',
  __API_SERVER_URL: 'https://api.expo.test',
};
const SECRETS = { robotAccessToken: 'robot-access-token' };

describe('Xcode compilation build cache', () => {
  beforeEach(() => {
    jest.mocked(generateXcodeCompilationCacheKeyAsync).mockResolvedValue({
      key: 'ios-xcode-compilation-cache-version-dependencies',
      keyPrefix: 'ios-xcode-compilation-cache-version-',
      xcodeVersion: 'Xcode 26.0 Build version 17A000',
    });
  });

  test('restores through the active build cache service', async () => {
    jest.mocked(downloadCacheAsync).mockResolvedValue({
      archivePath: '/tmp/cache.tar.gz',
      matchedKey: 'ios-xcode-compilation-cache-version-dependencies',
    });

    await restoreXcodeCompilationCacheAsync({
      logger: createMockLogger(),
      workingDirectory: WORKING_DIRECTORY,
      env: ENV,
      secrets: SECRETS,
    });

    expect(downloadCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'build-id',
        key: 'ios-xcode-compilation-cache-version-dependencies',
        keyPrefixes: ['ios-xcode-compilation-cache-version-'],
        paths: [XCODE_COMPILATION_CACHE_RELATIVE_PATH],
        platform: Platform.IOS,
      })
    );
    expect(decompressXcodeCompilationCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        archivePath: '/tmp/cache.tar.gz',
        workingDirectory: WORKING_DIRECTORY,
      })
    );
  });

  test('saves through the active build cache service', async () => {
    vol.fromJSON({ '/tmp/xcode-cache.tar.gz': 'cache' });
    jest.mocked(compressXcodeCompilationCacheAsync).mockResolvedValue({
      archivePath: '/tmp/xcode-cache.tar.gz',
    });

    await saveXcodeCompilationCacheAsync({
      logger: createMockLogger(),
      workingDirectory: WORKING_DIRECTORY,
      env: ENV,
      secrets: SECRETS,
    });

    expect(compressXcodeCompilationCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: WORKING_DIRECTORY,
      })
    );

    expect(uploadCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'build-id',
        key: 'ios-xcode-compilation-cache-version-dependencies',
        paths: [XCODE_COMPILATION_CACHE_RELATIVE_PATH],
        platform: Platform.IOS,
        size: 5,
      })
    );
  });
});
