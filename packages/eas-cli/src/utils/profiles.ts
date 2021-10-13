import { Platform } from '@expo/eas-build-job';

import Log from '../log';

export type ProfileData<T> = {
  profile: T;
  platform: Platform;
  profileName: string;
};

export async function getDefaultProfilesAsync<T>({
  platforms,
  profileName: profileNameArg,
  // eslint-disable-next-line async-protect/async-suffix
  readProfileAsync,
}: {
  platforms: Platform[];
  profileName?: string | null;
  readProfileAsync: (platform: Platform, profileName: string) => Promise<T>;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    let profile;
    let profileName = profileNameArg;

    if (!profileName) {
      try {
        profile = await readProfileAsync(platform, 'production');
        profileName = 'production';
      } catch (error) {
        try {
          profile = await readProfileAsync(platform, 'release');
          profileName = 'release';
          Log.warn(
            'The default profile changed to "production" from "release". We detected that you still have a "release" build profile, so we are using it. Update eas.json to have a profile named "production" under the `build` key, or specify which profile you\'d like to use with the --profile flag. This fallback behavior will be removed in the next major version of eas-cli.'
          );
        } catch (error) {
          throw new Error('There is no profile named "production" in eas.json');
        }
      }
    } else {
      profile = await readProfileAsync(platform, profileName);
    }

    return {
      profile,
      profileName,
      platform,
    };
  });

  return await Promise.all(results);
}
