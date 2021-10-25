import { Platform } from '@expo/eas-build-job';
import { errors } from '@expo/eas-json';

import Log from '../log';

export type ProfileData<T> = {
  profile: T;
  platform: Platform;
  profileName: string;
};

export async function getProfilesAsync<T>({
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
      } catch (errorOuter) {
        if (errorOuter instanceof errors.InvalidEasJsonError) {
          throw errorOuter;
        }
        try {
          profile = await readProfileAsync(platform, 'release');
          profileName = 'release';
          Log.warn(
            'The default profile changed from "release" to "production". We detected that you still have a "release" build profile, so we are using it. Update eas.json to have a profile named "production" under the `build` key, or specify which profile you\'d like to use with the --profile flag. This fallback behavior will be removed in the next major version of EAS CLI.'
          );
        } catch (errorInner) {
          if (errorInner instanceof errors.InvalidEasJsonError) {
            throw errorInner;
          }
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
