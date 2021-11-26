import { Platform } from '@expo/eas-build-job';
import {
  BuildProfile,
  EasJsonReader,
  ProfileType,
  SubmitProfile,
  errors,
  getDefaultSubmitProfile,
} from '@expo/eas-json';

import Log from '../log';

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
  profileName?: string;
  type: T;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    let profile: EasProfile<T>;
    let profileName = profileNameArg;

    if (!profileName) {
      try {
        profileName = 'production';
        profile = await readProfileAsync({ projectDir, platform, type, profileName });
      } catch (errorOuter) {
        if (!(errorOuter instanceof errors.MissingProfileError)) {
          throw errorOuter;
        }
        try {
          profileName = 'release';
          profile = await readProfileAsync({ projectDir, platform, type, profileName });
          Log.warn(
            'The default profile changed from "release" to "production". We detected that you still have a "release" build profile, so we are using it. Update eas.json to have a profile named "production" under the `build` key, or specify which profile you\'d like to use with the --profile flag. This fallback behavior will be removed in the next major version of EAS CLI.'
          );
        } catch (errorInner) {
          if (!(errorInner instanceof errors.MissingProfileError)) {
            throw errorInner;
          }
          const defaultProfile = getDefaultProfile({ platform, type });
          if (!defaultProfile) {
            throw errorInner;
          }
          profileName = '__default__';
          profile = defaultProfile;
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
  type: T;
  profileName: string;
}): Promise<EasProfile<T>> {
  const easJsonReader = new EasJsonReader(projectDir);
  if (type === 'build') {
    return (await easJsonReader.getBuildProfileAsync(platform, profileName)) as EasProfile<T>;
  } else {
    return (await easJsonReader.getSubmitProfileAsync(platform, profileName)) as EasProfile<T>;
  }
}

function getDefaultProfile<T extends ProfileType>({
  platform,
  type,
}: {
  platform: Platform;
  type: T;
}): EasProfile<T> | null {
  if (type === 'build') {
    return null;
  } else {
    return getDefaultSubmitProfile(platform) as EasProfile<T>;
  }
}
