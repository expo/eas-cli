import { AppObservePlatform } from '../graphql/generated';

export const APPLE_PLATFORM_FLAG_VALUE = 'apple';

const APPLE_OBSERVE_PLATFORMS: AppObservePlatform[] = [
  AppObservePlatform.Ios,
  AppObservePlatform.Ipados,
  AppObservePlatform.Tvos,
  AppObservePlatform.Macos,
];

export const allowedPlatformFlagValues = [
  ...Object.values(AppObservePlatform).map(s => s.toLowerCase()),
  APPLE_PLATFORM_FLAG_VALUE,
];

type PlatformFlagValue = (typeof allowedPlatformFlagValues)[number];

export type ObservePlatformKey = AppObservePlatform | 'APPLE';

export const observePlatformDisplayNames: Record<ObservePlatformKey, string> = {
  [AppObservePlatform.Android]: 'Android',
  [AppObservePlatform.Ios]: 'iOS',
  [AppObservePlatform.Ipados]: 'iPadOS',
  [AppObservePlatform.Tvos]: 'tvOS',
  [AppObservePlatform.Macos]: 'macOS',
  APPLE: 'Apple',
};

export interface ObservePlatformTarget {
  key: ObservePlatformKey;
  platforms: AppObservePlatform[];
}

function singlePlatformFromFlag(flag: PlatformFlagValue): AppObservePlatform {
  const platform = Object.values(AppObservePlatform).find(p => p.toLowerCase() === flag);
  if (!platform) {
    throw new Error(`Unknown platform flag value: "${flag}"`);
  }
  return platform;
}

export function observePlatformsFromFlag(
  flag: PlatformFlagValue | undefined
): AppObservePlatform[] | undefined {
  if (!flag) {
    return undefined;
  }
  if (flag === APPLE_PLATFORM_FLAG_VALUE) {
    return APPLE_OBSERVE_PLATFORMS;
  }
  return [singlePlatformFromFlag(flag)];
}

export function observePlatformTargetsFromFlag(
  flag: PlatformFlagValue | undefined
): ObservePlatformTarget[] {
  if (!flag) {
    return [
      { key: AppObservePlatform.Android, platforms: [AppObservePlatform.Android] },
      { key: AppObservePlatform.Ios, platforms: [AppObservePlatform.Ios] },
    ];
  }
  if (flag === APPLE_PLATFORM_FLAG_VALUE) {
    return [{ key: 'APPLE', platforms: APPLE_OBSERVE_PLATFORMS }];
  }
  const platform = singlePlatformFromFlag(flag);
  return [{ key: platform, platforms: [platform] }];
}
