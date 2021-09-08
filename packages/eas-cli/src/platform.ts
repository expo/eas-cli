import { AppPlatform } from './graphql/generated';

export const appPlatformDisplayNames: Record<AppPlatform, string> = {
  [AppPlatform.Android]: 'Android',
  [AppPlatform.Ios]: 'iOS',
};

export const appPlatformEmojis = {
  [AppPlatform.Ios]: '🍎',
  [AppPlatform.Android]: '🤖',
};

// for `eas build` and `eas submit`
export enum RequestedPlatform {
  Android = 'android',
  Ios = 'ios',
  All = 'all',
}

export const requestedPlatformDisplayNames: Record<RequestedPlatform, string> = {
  [RequestedPlatform.Android]: 'Android',
  [RequestedPlatform.Ios]: 'iOS',
  [RequestedPlatform.All]: 'Android and iOS',
};
