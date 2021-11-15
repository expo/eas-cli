import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonReader, SubmitProfile, errors } from '@expo/eas-json';

import Log from '../log';

type ProfileType = 'build' | 'submit';

type EasProfile<T extends ProfileType> = T extends 'build'
  ? BuildProfile<Platform>
  : SubmitProfile<Platform>;

export type ProfileData<T extends ProfileType> = {
  profile: EasProfile<T>;
  platform: Platform;
  profileName: string;
};

export async function getProfilesAsync<T extends ProfileType>({
  projectDir,
  platforms,
  profileName: profileNameArg,
  type,
}: {
  projectDir: string;
  platforms: Platform[];
  profileName?: string | null;
  type: T;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    let profile: EasProfile<T>;
    let profileName = profileNameArg;

    if (!profileName) {
      try {
        profile = await readProfileAsync({ projectDir, platform, type, profileName: 'production' });
        profileName = 'production';
      } catch (errorOuter) {
        if (errorOuter instanceof errors.InvalidEasJsonError) {
          throw errorOuter;
        }
        try {
          profile = await readProfileAsync({ projectDir, platform, type, profileName: 'release' });
          profileName = 'release';
          Log.warn(
            'The default profile changed from "release" to "production". We detected that you still have a "release" build profile, so we are using it. Update eas.json to have a profile named "production" under the `build` key, or specify which profile you\'d like to use with the --profile flag. This fallback behavior will be removed in the next major version of EAS CLI.'
          );
        } catch (errorInner) {
          if (errorInner instanceof errors.InvalidEasJsonError) {
            throw errorInner;
          }
          throw new Error(`There is no ${type} profile named "production" in eas.json`);
        }
      }
    } else {
      profile = await readProfileAsync({ projectDir, platform, type, profileName });
    }

    return {
      profile,
      profileName,
      platform,
    };
  });

  return await Promise.all(results);
}

async function readProfileAsync<T extends ProfileType>({
  projectDir,
  platform,
  type,
  profileName,
}: {
  projectDir: string;
  platform: Platform;
  type: ProfileType;
  profileName: string;
}): Promise<EasProfile<T>> {
  const easJsonReader = new EasJsonReader(projectDir);
  if (type === 'build') {
    return (await easJsonReader.readBuildProfileAsync(platform, profileName)) as EasProfile<T>;
  } else {
    return (await easJsonReader.readSubmitProfileAsync(platform, profileName)) as EasProfile<T>;
  }
}
