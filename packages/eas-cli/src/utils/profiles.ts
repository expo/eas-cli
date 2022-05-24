import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonReader, ProfileType, SubmitProfile, errors } from '@expo/eas-json';

import { UserInputResourceClass } from '../build/types';
import { BuildResourceClass } from '../graphql/generated';

type EasProfile<T extends ProfileType> = T extends 'build'
  ? BuildProfile<Platform>
  : SubmitProfile<Platform>;

export type ProfileData<T extends ProfileType> = {
  profile: EasProfile<T>;
  platform: Platform;
  resourceClass: BuildResourceClass;
  profileName: string;
};

function getBuildResourceClassForPlatform({
  resourceClass,
  platform,
}: {
  resourceClass?: UserInputResourceClass;
  platform: Platform;
}): BuildResourceClass {
  switch (platform) {
    case Platform.ANDROID:
      if (resourceClass === undefined || resourceClass === UserInputResourceClass.DEFAULT) {
        return BuildResourceClass.AndroidDefault;
      } else if (resourceClass === UserInputResourceClass.LARGE) {
        return BuildResourceClass.AndroidLarge;
      } else {
        throw new errors.InvalidResourceClassError(`Invalid resource-class: ${resourceClass}`);
      }
    case Platform.IOS:
      if (resourceClass === undefined || resourceClass === UserInputResourceClass.DEFAULT) {
        return BuildResourceClass.IosDefault;
      } else if (resourceClass === UserInputResourceClass.LARGE) {
        return BuildResourceClass.IosLarge;
      } else {
        throw new errors.InvalidResourceClassError(`Invalid resource-class: ${resourceClass}`);
      }
    default:
      throw new errors.InvalidResourceClassError(`Invalid resource-class: ${resourceClass}`);
  }
}

export async function getProfilesAsync<T extends ProfileType>({
  easJsonReader,
  platforms,
  profileName,
  type,
  userInputResourceClass,
}: {
  easJsonReader: EasJsonReader;
  platforms: Platform[];
  profileName?: string;
  type: T;
  userInputResourceClass?: UserInputResourceClass;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    const profile = await readProfileAsync({
      easJsonReader,
      platform,
      type,
      profileName,
    });
    return {
      profile,
      profileName: profileName ?? 'production',
      platform,
      resourceClass: getBuildResourceClassForPlatform({
        resourceClass: userInputResourceClass,
        platform,
      }),
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
  profileName?: string;
}): Promise<EasProfile<T>> {
  if (type === 'build') {
    return (await easJsonReader.getBuildProfileAsync(platform, profileName)) as EasProfile<T>;
  } else {
    return (await easJsonReader.getSubmitProfileAsync(platform, profileName)) as EasProfile<T>;
  }
}
