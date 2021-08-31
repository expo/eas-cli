import { RequestedPlatform } from './types';

export const requestedPlatformDisplayNames: Record<RequestedPlatform, string> = {
  [RequestedPlatform.Ios]: 'iOS',
  [RequestedPlatform.Android]: 'Android',
  [RequestedPlatform.All]: 'Android and iOS',
};
