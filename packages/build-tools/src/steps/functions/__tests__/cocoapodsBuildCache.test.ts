import { spawnAsync } from '@expo/steps';
import { vol } from 'memfs';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { Datadog } from '../../../datadog';
import {
  compressCocoapodsCacheAsync,
  getCocoapodsCachePaths,
  resolveCocoapodsCacheKeyAsync,
  restoreCocoapodsCacheArchiveAsync,
} from '../../../utils/cocoapodsCache';
import { downloadCacheAsync } from '../restoreCache';
import { restoreCocoapodsCacheAsync } from '../restoreBuildCache';
import { uploadCacheAsync } from '../saveCache';
import { saveCocoapodsCacheAsync } from '../saveBuildCache';

jest.mock('@expo/steps', () => ({
  ...jest.requireActual('@expo/steps'),
  spawnAsync: jest.fn(),
}));
jest.mock('../restoreCache', () => ({
  decompressCacheAsync: jest.fn(),
  downloadCacheAsync: jest.fn(),
  downloadPublicCacheAsync: jest.fn(),
}));
jest.mock('../saveCache', () => ({
  compressCacheAsync: jest.fn(),
  uploadCacheAsync: jest.fn(),
}));
jest.mock('../../../utils/cocoapodsCache', () => ({
  compressCocoapodsCacheAsync: jest.fn(),
  getCocoapodsCachePaths: jest.fn(),
  resolveCocoapodsCacheKeyAsync: jest.fn(),
  restoreCocoapodsCacheArchiveAsync: jest.fn(),
}));

const logger = createMockLogger();
const env = {
  EAS_PODS_CACHE: '1',
  EAS_BUILD_ID: 'build-id',
  __API_SERVER_URL: 'https://api.expo.test',
};
const secrets = { robotAccessToken: 'robot-token' };

describe('CocoaPods build cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vol.fromJSON(
      {
        '/workingdir/ios/Pods/Manifest.lock': 'manifest',
        '/workingdir/ios/Podfile.lock': 'lockfile',
        '/tmp/cocoapods-cache.tar.gz': 'archive',
      },
      '/'
    );
    jest.mocked(getCocoapodsCachePaths).mockReturnValue({
      iosDirectory: '/workingdir/ios',
      podsDirectory: '/workingdir/ios/Pods',
      podfileLockPath: '/workingdir/ios/Podfile.lock',
    });
    jest.mocked(resolveCocoapodsCacheKeyAsync).mockResolvedValue({
      key: 'ios-pods-1.16.2-lock-hash',
      keyPrefix: 'ios-pods-1.16.2-',
    });
    jest.mocked(spawnAsync).mockResolvedValue({ stdout: '1.16.2\n' } as any);
  });

  it('does nothing when the cache is disabled', async () => {
    await restoreCocoapodsCacheAsync({
      logger,
      workingDirectory: '/workingdir',
      env: {},
      secrets,
    });
    await saveCocoapodsCacheAsync({
      logger,
      workingDirectory: '/workingdir',
      env: {},
      secrets,
    });

    expect(spawnAsync).not.toHaveBeenCalled();
  });

  it('restores the newest matching CocoaPods cache', async () => {
    jest.mocked(downloadCacheAsync).mockResolvedValue({
      archivePath: '/tmp/cocoapods-cache.tar.gz',
      matchedKey: 'ios-pods-1.16.2-older-lock-hash',
    });
    const datadogLogSpy = jest.spyOn(Datadog, 'log');

    await restoreCocoapodsCacheAsync({
      logger,
      workingDirectory: '/workingdir',
      env,
      secrets,
    });

    expect(downloadCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'ios-pods-1.16.2-lock-hash',
        keyPrefixes: ['ios-pods-1.16.2-'],
        paths: ['/workingdir/ios/Pods'],
      })
    );
    expect(restoreCocoapodsCacheArchiveAsync).toHaveBeenCalledWith({
      archivePath: '/tmp/cocoapods-cache.tar.gz',
      workingDirectory: '/workingdir',
    });
    expect(datadogLogSpy).toHaveBeenCalledWith('CocoaPods cache restored (prefix_match)', {
      event: 'cocoapods_cache_restored',
      cache_hit_type: 'prefix_match',
    });
  });

  it('compresses and saves the installed Pods directory', async () => {
    jest.mocked(compressCocoapodsCacheAsync).mockResolvedValue({
      archivePath: '/tmp/cocoapods-cache.tar.gz',
    });

    await saveCocoapodsCacheAsync({
      logger,
      workingDirectory: '/workingdir',
      env,
      secrets,
    });

    expect(uploadCacheAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        archivePath: '/tmp/cocoapods-cache.tar.gz',
        key: 'ios-pods-1.16.2-lock-hash',
        paths: ['/workingdir/ios/Pods'],
      })
    );
  });
});
