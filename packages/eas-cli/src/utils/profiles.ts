import { Platform } from '@expo/eas-build-job';

import Log from '../log';

export type ProfileData<T> = {
  profile: T;
  platform: Platform;
  profileName: string;
};

export async function getDefaultProfilesAsync<T>({
  platforms,
  profileName,

  // eslint-disable-next-line async-protect/async-suffix
  readProfileAsync,
}: {
  platforms: Platform[];
  profileName?: string | null;
  readProfileAsync: (platform: Platform, profileName: string) => Promise<T>;
}): Promise<ProfileData<T>[]> {
  return await Promise.all(
    platforms.map(async function (platform) {
      if (!profileName) {
        try {
          const profile = await readProfileAsync(platform, 'production');
          return {
            profile,
            profileName: 'production',
            platform,
          };
        } catch (error) {
          try {
            const profile = await readProfileAsync(platform, 'release');
            Log.warn(
              'The default profile changed to "production" from "release". We detected that you still have a "release" build profile, so we are using it. Update eas.json to have a profile named "production" under the `build` key, or specify which profile you\'d like to use with the --profile flag. This fallback behavior will be removed in the next major version of eas-cli.'
            );
            return {
              profile,
              profileName: 'release',
              platform,
            };
          } catch (error) {
            throw new Error('There is no profile named "production" in eas.json');
          }
        }
      } else {
        const profile = await readProfileAsync(platform, profileName);
        return {
          profile,
          profileName,
          platform,
        };
      }
    })
  );
}
