import { Platform } from '@expo/eas-build-job';
import {
  BuildProfile,
  EasJsonAccessor,
  EasJsonUtils,
  ProfileType,
  SubmitProfile,
} from '@expo/eas-json';

import Log, { learnMore } from '../log';

type EasProfile<T extends ProfileType> = T extends 'build'
  ? BuildProfile<Platform>
  : SubmitProfile<Platform>;

export type ProfileData<T extends ProfileType> = {
  profile: EasProfile<T>;
  platform: Platform;
  profileName: string;
};

export async function getProfilesAsync<T extends ProfileType>({
  easJsonAccessor,
  platforms,
  profileName,
  type,
}: {
  easJsonAccessor: EasJsonAccessor;
  platforms: Platform[];
  profileName?: string;
  type: T;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    const profile = await readProfileAsync({
      easJsonAccessor,
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
  easJsonAccessor,
  platform,
  type,
  profileName,
}: {
  easJsonAccessor: EasJsonAccessor;
  platform: Platform;
  type: T;
  profileName?: string;
}): Promise<EasProfile<T>> {
  if (type === 'build') {
    const buildProfile = await EasJsonUtils.getBuildProfileAsync(
      easJsonAccessor,
      platform,
      profileName
    );

    const deprecationWarnings = EasJsonUtils.getBuildProfileDepreactionWarnings(buildProfile);
    if (deprecationWarnings.length > 0) {
      Log.newLine();
      Log.warn('Detected deprecated fields in eas.json:');
      for (const warning of deprecationWarnings) {
        const warnlog: string = warning.message.map(line => `\t${line}`).join('\n');
        Log.warn(warnlog);
        if (warning.docsUrl) {
          Log.warn(`\t${learnMore(warning.docsUrl)}`);
        }
        Log.newLine();
      }
    }

    return buildProfile as EasProfile<T>;
  } else {
    return (await EasJsonUtils.getSubmitProfileAsync(
      easJsonAccessor,
      platform,
      profileName
    )) as EasProfile<T>;
  }
}
