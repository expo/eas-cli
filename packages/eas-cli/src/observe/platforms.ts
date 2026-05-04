import { AppObservePlatform, AppPlatform } from '../graphql/generated';

/**
 * Allowed values for the --platform flag in observe commands.
 * Derived from the AppObservePlatform enum so new platforms added on
 * the server are automatically picked up.
 */
export const allowedPlatformFlagValues = Object.values(AppObservePlatform).map(s =>
  s.toLowerCase()
);

const defaultAppObservePlatform = AppObservePlatform.Ios;
const defaultAppPlatform = AppPlatform.Ios;

type PlatformFlagValue = (typeof allowedPlatformFlagValues)[number];

/**
 * Resolve a single AppObservePlatform from a --platform flag value.
 * Returns undefined when no flag was provided.
 */
export function appObservePlatformFromFlag(
  flag: PlatformFlagValue | undefined
): AppObservePlatform | undefined {
  if (!flag) {
    return undefined;
  }
  switch (flag) {
    case 'android':
      return AppObservePlatform.Android;
    case 'ios':
      return AppObservePlatform.Ios;
  }
  return defaultAppObservePlatform;
}

/**
 * Resolve a list of AppPlatform values from a --platform flag value.
 * Returns the single matching platform when a flag is provided, or all
 * known platforms when no flag is provided (so the caller queries every
 * platform).
 */
export function appPlatformsFromFlag(flag: PlatformFlagValue | undefined): AppPlatform[] {
  if (!flag) {
    return [AppPlatform.Android, AppPlatform.Ios];
  }
  switch (flag) {
    case 'android':
      return [AppPlatform.Android];
    case 'ios':
      return [AppPlatform.Ios];
  }
  return [defaultAppPlatform];
}
