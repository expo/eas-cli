import { Platform } from '@expo/eas-build-job';

import { AppPlatform } from '../generated';

export function toAppPlatform(platform: Platform): AppPlatform {
  if (platform === Platform.ANDROID) {
    return AppPlatform.Android;
  } else if (platform === Platform.IOS) {
    return AppPlatform.Ios;
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}
