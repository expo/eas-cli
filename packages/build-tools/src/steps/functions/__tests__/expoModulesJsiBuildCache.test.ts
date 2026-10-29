import { Platform } from '@expo/eas-build-job';
import { spawnAsync } from '@expo/steps';
import fs from 'fs';
import { vol } from 'memfs';

import { createMockLogger } from '../../../__tests__/utils/logger';
import { saveCcacheAsync } from '../saveBuildCache';
import { compressCacheAsync, uploadCacheAsync } from '../saveCache';

jest.mock('@expo/steps', () => ({
  ...jest.requireActual('@expo/steps'),
  spawnAsync: jest.fn(),
}));
jest.mock('../../../utils/cacheKey', () => ({
  ...jest.requireActual('../../../utils/cacheKey'),
  generateDefaultBuildCacheKeyAsync: jest.fn().mockResolvedValue('cache-key'),
  getCcachePath: jest.fn().mockReturnValue('/cache/ccache'),
}));
jest.mock('../saveCache', () => ({
  compressCacheAsync: jest.fn(),
  uploadCacheAsync: jest.fn(),
}));

it.each([Platform.IOS, Platform.ANDROID])(
  'includes and prunes JSI slices only for iOS (%s)',
  async platform => {
    const cachePath = '/cache/jsi';
    const recent = `${cachePath}/hash/ios-arm64.tar.gz`;
    const stale = `${cachePath}/old-hash/ios-arm64.tar.gz`;
    vol.fromJSON({ [recent]: 'recent', [stale]: 'old', '/tmp/cache.tar.gz': 'archive' });
    fs.utimesSync(stale, new Date(0), new Date(0));
    jest.mocked(spawnAsync).mockResolvedValue({ stdout: '' } as any);
    jest.mocked(compressCacheAsync).mockResolvedValue({ archivePath: '/tmp/cache.tar.gz' });
    await saveCcacheAsync({
      logger: createMockLogger(),
      workingDirectory: '/workingdir',
      target: platform === Platform.IOS ? { platform, simulator: false } : { platform },
      evictUsedBefore: new Date(Date.now() - 60_000),
      env: {
        HOME: '/home/worker',
        EAS_USE_CACHE: '1',
        EAS_BUILD_ID: 'build-id',
        __API_SERVER_URL: 'https://api.expo.test',
        EXPO_MODULES_JSI_XCFRAMEWORK_CACHE_DIR: cachePath,
      },
      secrets: { robotAccessToken: 'test-token' },
    });
    const paths = platform === Platform.IOS ? ['/cache/ccache', cachePath] : ['/cache/ccache'];
    expect(compressCacheAsync).toHaveBeenLastCalledWith(expect.objectContaining({ paths }));
    expect(uploadCacheAsync).toHaveBeenLastCalledWith(expect.objectContaining({ paths }));
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(stale)).toBe(platform !== Platform.IOS);
  }
);
