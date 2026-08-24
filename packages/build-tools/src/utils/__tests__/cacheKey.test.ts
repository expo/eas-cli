import { Platform } from '@expo/eas-build-job';

import { getCcacheKeyPrefix } from '../cacheKey';

describe(getCcacheKeyPrefix, () => {
  it('uses separate prefixes for iOS device and simulator builds', () => {
    expect(getCcacheKeyPrefix({ platform: Platform.IOS, simulator: false })).toBe(
      'ios-device-ccache-'
    );
    expect(getCcacheKeyPrefix({ platform: Platform.IOS, simulator: true })).toBe(
      'ios-simulator-ccache-'
    );
  });

  it('does not change the Android prefix', () => {
    expect(getCcacheKeyPrefix({ platform: Platform.ANDROID })).toBe('android-ccache-');
  });
});
