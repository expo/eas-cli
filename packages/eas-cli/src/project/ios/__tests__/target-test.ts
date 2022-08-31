import { Platform as ApplePlatform } from '@expo/apple-utils';

import { testTarget } from '../../../credentials/__tests__/fixtures-ios';
import { getApplePlatformFromSdkRoot } from '../target';

function getApplePlatform(sdkRoot: string): ApplePlatform | null {
  const target = {
    ...testTarget,
    buildSettings: {
      SDKROOT: sdkRoot,
    },
  };
  return getApplePlatformFromSdkRoot(target);
}

describe(getApplePlatformFromSdkRoot, () => {
  test('all enumerations work with the function', () => {
    for (const platform of Object.values(ApplePlatform)) {
      switch (platform) {
        case ApplePlatform.IOS:
        case ApplePlatform.TV_OS:
        case ApplePlatform.MAC_OS:
          break;
        default:
          throw new Error(`Update the function to work with ${platform}`);
      }
    }
  });
  test('existing SDKs work with the function', () => {
    // sdks from `xcodebuild -showsdks`
    expect(getApplePlatform('iphoneos14.4')).toBe(ApplePlatform.IOS);
    expect(getApplePlatform('iphonesimulator14.4')).toBe(null);
    expect(getApplePlatform('driverkit.macosx20.2 ')).toBe(ApplePlatform.MAC_OS);
    expect(getApplePlatform('macosx11.1')).toBe(ApplePlatform.MAC_OS);
    expect(getApplePlatform('appletvos14.3')).toBe(ApplePlatform.TV_OS);
    expect(getApplePlatform('appletvsimulator14.3')).toBe(null);
    expect(getApplePlatform('watchos7.2')).toBe(null);
    expect(getApplePlatform('watchsimulator7.2')).toBe(null);
  });
});
