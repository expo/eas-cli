import { Platform } from '@expo/eas-build-job';

import { AppPlatform } from './graphql/generated';
import Log from './log';
import { promptAsync } from './prompts';

export const appPlatformDisplayNames: Record<AppPlatform, string> = {
  [AppPlatform.Android]: 'Android',
  [AppPlatform.Ios]: 'iOS',
};

export const appPlatformEmojis = {
  [AppPlatform.Ios]: '🍏',
  [AppPlatform.Android]: '🤖',
};

// for `eas build`, `eas submit`, and `eas update`
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

export async function selectRequestedPlatformAsync(platform?: string): Promise<RequestedPlatform> {
  if (
    platform &&
    Object.values(RequestedPlatform).includes(platform.toLowerCase() as RequestedPlatform)
  ) {
    return platform.toLowerCase() as RequestedPlatform;
  }

  const { requestedPlatform } = await promptAsync({
    type: 'select',
    message: 'Select platform',
    name: 'requestedPlatform',
    choices: [
      { title: 'All', value: RequestedPlatform.All },
      { title: 'Android', value: RequestedPlatform.Android },
      { title: 'iOS', value: RequestedPlatform.Ios },
    ],
  });
  return requestedPlatform;
}

export async function selectPlatformAsync(
  platform?: string,
  allowExit?: boolean
): Promise<Platform> {
  if (platform && Object.values(Platform).includes(platform.toLowerCase() as Platform)) {
    return platform.toLowerCase() as Platform;
  }

  const platformChoices: { title: string; value: Platform | 'Exit' }[] = [
    { title: 'Android', value: Platform.ANDROID },
    { title: 'iOS', value: Platform.IOS },
  ];

  if (allowExit) {
    platformChoices.push({ title: 'Exit', value: 'Exit' });
  }

  const result: any = await promptAsync({
    type: 'select',
    message: 'Select platform',
    name: 'resolvedPlatform',
    choices: [
      { title: 'Android', value: Platform.ANDROID },
      { title: 'iOS', value: Platform.IOS },
      { title: 'Exit', value: 'Exit' },
    ],
  });
  if (result.resolvedPlatform === 'Exit') {
    Log.addNewLineIfNone();
    Log.log('Exiting');
    process.exit(0);
  }
  return result.resolvedPlatform;
}

export function toPlatforms(requestedPlatform: RequestedPlatform): Platform[] {
  if (requestedPlatform === RequestedPlatform.All) {
    return [Platform.ANDROID, Platform.IOS];
  } else if (requestedPlatform === RequestedPlatform.Android) {
    return [Platform.ANDROID];
  } else {
    return [Platform.IOS];
  }
}
