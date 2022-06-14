import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonReader, ProfileType, SubmitProfile } from '@expo/eas-json';

type EasProfile<T extends ProfileType> = T extends 'build'
  ? BuildProfile<Platform>
  : SubmitProfile<Platform>;

export type ProfileData<T extends ProfileType> = {
  profile: EasProfile<T>;
  platform: Platform;
  profileName: string;
};

export async function getProfilesAsync<T extends ProfileType>({
  easJsonReader,
  platforms,
  profileName,
  type,
}: {
  easJsonReader: EasJsonReader;
  platforms: Platform[];
  profileName?: string;
  type: T;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    const profile = await readProfileAsync({
      easJsonReader,
      platform,
      type,
      profileName: profileName ?? 'production',
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
  easJsonReader,
  platform,
  type,
  profileName,
}: {
  easJsonReader: EasJsonReader;
  platform: Platform;
  type: T;
  profileName: string;
}): Promise<EasProfile<T>> {
  if (type === 'build') {
    return (await easJsonReader.getBuildProfileAsync(platform, profileName)) as EasProfile<T>;
  } else {
    return (await easJsonReader.getSubmitProfileAsync(platform, profileName)) as EasProfile<T>;
  }
}
