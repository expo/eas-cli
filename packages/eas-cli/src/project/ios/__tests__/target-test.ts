import { testTarget } from '../../../credentials/__tests__/fixtures-ios';
import { ApplePlatform } from '../../../credentials/ios/appstore/constants';
import { Target } from '../../../credentials/ios/types';
import { getApplePlatformFromDeviceFamily, getApplePlatformFromSdkRoot } from '../target';

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
