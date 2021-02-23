import { Platform, RequestedPlatform } from './types';

export const platformDisplayNames = {
  [RequestedPlatform.iOS]: 'iOS',
  [RequestedPlatform.Android]: 'Android',
  [RequestedPlatform.All]: 'Android and iOS',
};

export const platformEmojis = {
  [Platform.IOS]: '🍎',
  [Platform.ANDROID]: '🤖',
};
