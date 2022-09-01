import { testTarget } from '../../../credentials/__tests__/fixtures-ios';
import { ApplePlatform } from '../../../credentials/ios/appstore/constants';
import { getApplePlatformFromSdkRoot } from '../target';

function getApplePlatform(sdkRoot: string): ApplePlatform {
  const target = {
    ...testTarget,
    buildSettings: {
      SDKROOT: sdkRoot,
    },
  };
  return getApplePlatformFromSdkRoot(target);
}

describe(getApplePlatformFromSdkRoot, () => {
  // Update `getApplePlatformFromSdkRoot` to be compatible with new Apple Platforms
  test('all enumerations work with the function', () => {
    expect(Object.values(ApplePlatform).sort()).toEqual(
      [ApplePlatform.IOS, ApplePlatform.TV_OS, ApplePlatform.MAC_OS].sort()
    );
  });
  test('existing SDKs work with the function', () => {
    // sdks from `xcodebuild -showsdks`
    expect(getApplePlatform('iphoneos14.4')).toBe(ApplePlatform.IOS);
    expect(getApplePlatform('iphonesimulator14.4')).toBe(ApplePlatform.IOS);
    expect(getApplePlatform('driverkit.macosx20.2 ')).toBe(ApplePlatform.MAC_OS);
    expect(getApplePlatform('macosx11.1')).toBe(ApplePlatform.MAC_OS);
    expect(getApplePlatform('appletvos14.3')).toBe(ApplePlatform.TV_OS);
    expect(getApplePlatform('appletvsimulator14.3')).toBe(ApplePlatform.IOS);
    expect(getApplePlatform('watchos7.2')).toBe(ApplePlatform.IOS);
    expect(getApplePlatform('watchsimulator7.2')).toBe(ApplePlatform.IOS);
  });
});
