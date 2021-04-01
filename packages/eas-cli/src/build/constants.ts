import { AppPlatform } from '../graphql/generated';
import { Platform, RequestedPlatform } from './types';

export const requestedPlatformDisplayNames: Record<RequestedPlatform, string> = {
  [RequestedPlatform.iOS]: 'iOS',
  [RequestedPlatform.Android]: 'Android',
  [RequestedPlatform.All]: 'Android and iOS',
};

export const appPlatformDisplayNames: Record<AppPlatform, string> = {
  [AppPlatform.Android]: 'Android',
  [AppPlatform.Ios]: 'iOS',
};

export const platformEmojis = {
  [Platform.IOS]: '🍎',
  [Platform.ANDROID]: '🤖',
};

export const appPlatformEmojis = {
  [AppPlatform.Ios]: '🍎',
  [AppPlatform.Android]: '🤖',
};
