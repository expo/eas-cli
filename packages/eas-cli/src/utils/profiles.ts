import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonUtils, ProfileType, SubmitProfile } from '@expo/eas-json';

type EasProfile<T extends ProfileType> = T extends 'build'
  ? BuildProfile<Platform>
  : SubmitProfile<Platform>;

export type ProfileData<T extends ProfileType> = {
  profile: EasProfile<T>;
  platform: Platform;
  profileName: string;
};

export async function getProfilesAsync<T extends ProfileType>({
  easJsonUtils,
  platforms,
  profileName,
  type,
}: {
  easJsonUtils: EasJsonUtils;
  platforms: Platform[];
  profileName?: string;
  type: T;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    const profile = await readProfileAsync({
      easJsonUtils,
      platform,
      type,
      profileName,
    });
    return {
      profile,
      profileName: profileName ?? 'production',
      platform,
    };
  });

  return await Promise.all(results);
}

async function readProfileAsync<T extends ProfileType>({
  easJsonUtils,
  platform,
  type,
  profileName,
}: {
  easJsonUtils: EasJsonUtils;
  platform: Platform;
  type: T;
  profileName?: string;
}): Promise<EasProfile<T>> {
  if (type === 'build') {
    return (await easJsonUtils.getBuildProfileAsync(platform, profileName)) as EasProfile<T>;
  } else {
    return (await easJsonUtils.getSubmitProfileAsync(platform, profileName)) as EasProfile<T>;
  }
}
