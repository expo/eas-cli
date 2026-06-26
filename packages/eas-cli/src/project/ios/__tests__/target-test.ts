import { testTarget } from '../../../credentials/__tests__/fixtures-ios';
import { ApplePlatform } from '../../../credentials/ios/appstore/constants';
import { Target } from '../../../credentials/ios/types';
import {
  getApplePlatformFromDeviceFamily,
  getApplePlatformFromSdkRoot,
  getApplePlatformFromTarget,
  getManagedTvBuildSettings,
} from '../target';

function getApplePlatformWithSdkRoot(sdkRoot: string): ApplePlatform | null {
  const target = {
    ...testTarget,
    buildSettings: {
      SDKROOT: sdkRoot,
    },
  };
  return getApplePlatformFromSdkRoot(target);
}

function getApplePlatformWithDeviceFamily(
  deviceFamily: string | number | undefined
): ApplePlatform | null {
  const target: Target = {
    ...testTarget,
    buildSettings: {
      TARGETED_DEVICE_FAMILY: deviceFamily,
    },
  };
  return getApplePlatformFromDeviceFamily(target);
}

describe(getApplePlatformFromSdkRoot, () => {
  // Update `getApplePlatformFromSdkRoot` to be compatible with new Apple Platforms
  test('all enumerations work with the function', () => {
    expect(Object.values(ApplePlatform).sort()).toEqual(
      [ApplePlatform.IOS, ApplePlatform.TV_OS, ApplePlatform.MAC_OS, ApplePlatform.VISION_OS].sort()
    );
  });
  test('existing SDKs work with the function', () => {
    // sdks from `xcodebuild -showsdks`
    expect(getApplePlatformWithSdkRoot('iphoneos14.4')).toBe(ApplePlatform.IOS);
    expect(getApplePlatformWithSdkRoot('iphonesimulator14.4')).toBe(null);
    expect(getApplePlatformWithSdkRoot('driverkit.macosx20.2 ')).toBe(ApplePlatform.MAC_OS);
    expect(getApplePlatformWithSdkRoot('macosx11.1')).toBe(ApplePlatform.MAC_OS);
    expect(getApplePlatformWithSdkRoot('appletvos14.3')).toBe(ApplePlatform.TV_OS);
    expect(getApplePlatformWithSdkRoot('appletvsimulator14.3')).toBe(null);
    expect(getApplePlatformWithSdkRoot('watchos7.2')).toBe(null);
    expect(getApplePlatformWithSdkRoot('watchsimulator7.2')).toBe(null);
  });
});

describe(getApplePlatformFromDeviceFamily, () => {
  test('apple platform can be obtained from device family types', () => {
    expect(getApplePlatformWithDeviceFamily('1,2')).toBe(ApplePlatform.IOS);
    expect(getApplePlatformWithDeviceFamily('1')).toBe(ApplePlatform.IOS);
    expect(getApplePlatformWithDeviceFamily('3')).toBe(ApplePlatform.TV_OS);
    expect(getApplePlatformWithDeviceFamily(1)).toBe(ApplePlatform.IOS);
    expect(getApplePlatformWithDeviceFamily(3)).toBe(ApplePlatform.TV_OS);
    expect(getApplePlatformWithDeviceFamily(undefined)).toBe(null);
    expect(getApplePlatformWithDeviceFamily('ilovecats')).toBe(null);
  });
});

describe(getManagedTvBuildSettings, () => {
  const originalExpoTv = process.env.EXPO_TV;
  afterEach(() => {
    if (originalExpoTv === undefined) {
      delete process.env.EXPO_TV;
    } else {
      process.env.EXPO_TV = originalExpoTv;
    }
  });

  test('returns undefined when EXPO_TV is not set in env or process.env', () => {
    delete process.env.EXPO_TV;
    expect(getManagedTvBuildSettings(undefined)).toBeUndefined();
    expect(getManagedTvBuildSettings({})).toBeUndefined();
    expect(getManagedTvBuildSettings({ EXPO_TV: '' })).toBeUndefined();
    expect(getManagedTvBuildSettings({ EXPO_TV: '0' })).toBeUndefined();
    expect(getManagedTvBuildSettings({ EXPO_TV: 'false' })).toBeUndefined();
    expect(getManagedTvBuildSettings({ EXPO_TV: 'no' })).toBeUndefined();
  });

  test('returns TARGETED_DEVICE_FAMILY=3 when EXPO_TV is truthy in the env parameter (eas.json case)', () => {
    delete process.env.EXPO_TV;
    for (const value of ['1', 'true', 'yes', 'TRUE', 'Yes']) {
      expect(getManagedTvBuildSettings({ EXPO_TV: value })).toEqual({
        TARGETED_DEVICE_FAMILY: '3',
      });
    }
  });

  test('falls back to process.env when env is missing EXPO_TV (shell case)', () => {
    process.env.EXPO_TV = '1';
    expect(getManagedTvBuildSettings(undefined)).toEqual({ TARGETED_DEVICE_FAMILY: '3' });
    expect(getManagedTvBuildSettings({})).toEqual({ TARGETED_DEVICE_FAMILY: '3' });
  });

  test('env-parameter EXPO_TV takes precedence over process.env (eas.json overrides shell)', () => {
    process.env.EXPO_TV = '0';
    expect(getManagedTvBuildSettings({ EXPO_TV: '1' })).toEqual({
      TARGETED_DEVICE_FAMILY: '3',
    });

    process.env.EXPO_TV = '1';
    expect(getManagedTvBuildSettings({ EXPO_TV: '0' })).toBeUndefined();
  });

  test('feeds into getApplePlatformFromTarget so managed tvOS targets resolve to TV_OS', () => {
    delete process.env.EXPO_TV;
    const target: Target = {
      ...testTarget,
      buildSettings: getManagedTvBuildSettings({ EXPO_TV: '1' }),
    };
    expect(getApplePlatformFromTarget(target)).toBe(ApplePlatform.TV_OS);

    const iosTarget: Target = {
      ...testTarget,
      buildSettings: getManagedTvBuildSettings({}),
    };
    expect(getApplePlatformFromTarget(iosTarget)).toBe(ApplePlatform.IOS);
  });
});
