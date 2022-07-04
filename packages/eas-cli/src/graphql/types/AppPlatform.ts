import { Platform } from '@expo/eas-build-job';

import { AppPlatform } from '../generated.js';

export function toAppPlatform(platform: Platform): AppPlatform {
  if (platform === Platform.ANDROID) {
    return AppPlatform.Android;
  } else if (platform === Platform.IOS) {
    return AppPlatform.Ios;
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function toPlatform(appPlatform: AppPlatform): Platform {
  if (appPlatform === AppPlatform.Android) {
    return Platform.ANDROID;
  } else {
    return Platform.IOS;
  }
}
