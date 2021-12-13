import { Platform } from '@expo/eas-build-job';
import {
  BuildProfile,
  EasJsonReader,
  ProfileType,
  SubmitProfile,
  errors,
  getDefaultSubmitProfile,
} from '@expo/eas-json';
import chalk from 'chalk';

import Log from '../log';
import { ExpoChoice, selectAsync } from '../prompts';

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
  profileName,
  type,
}: {
  projectDir: string;
  platforms: Platform[];
  profileName?: string;
  type: T;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    if (profileName) {
      const profile = await readProfileAsync({ projectDir, platform, type, profileName });
      return {
        profile,
        profileName,
        platform,
      };
    }

    try {
      const profile = await readProfileAsync({
        projectDir,
        platform,
        type,
        profileName: 'production',
      });
      return {
        profile,
        profileName: 'production',
        platform,
      };
    } catch (error) {
      if (!(error instanceof errors.MissingProfileError)) {
        throw error;
      }
    }

    try {
      const profile = await readProfileAsync({
        projectDir,
        platform,
        type,
        profileName: 'release',
      });
      Log.warn(
        `The default profile changed from ${chalk.bold('release')} to ${chalk.bold(
          'production'
        )}. We detected that you still have a ${chalk.bold(
          'release'
        )} build profile, so we are using it. Update eas.json to have a profile named ${chalk.bold(
          'production'
        )} under the ${chalk.bold(
          'build'
        )} key, or specify which profile you'd like to use with the ${chalk.bold(
          '--profile'
        )} flag. This fallback behavior will be removed in the next major version of EAS CLI.`
      );
      return {
        profile,
        profileName: 'release',
        platform,
      };
    } catch (error) {
      if (!(error instanceof errors.MissingProfileError)) {
        throw error;
      }
    }
    const defaultProfile = getDefaultProfile({ platform, type });
    if (defaultProfile) {
      return {
        profile: defaultProfile,
        profileName: '__default__',
        platform,
      };
    }

    const profileNames = await readProfileNamesAsync({
      projectDir,
      type,
    });
    if (profileNames.length === 0) {
      throw new errors.MissingProfileError(
        `Missing profile in eas.json: ${profileName ?? 'production'}`
      );
    }
    const choices: ExpoChoice<string>[] = profileNames.map(profileName => ({
      title: profileName,
      value: profileName,
    }));
    const chosenProfileName = await selectAsync(
      'The "production" profile is missing in eas.json. Pick another profile:',
      choices
    );
    const profile = await readProfileAsync({
      projectDir,
      platform,
      type,
      profileName: chosenProfileName,
    });
    return {
      profile,
      profileName: chosenProfileName,
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

async function readProfileNamesAsync({
  projectDir,
  type,
}: {
  projectDir: string;
  type: ProfileType;
}): Promise<string[]> {
  const easJsonReader = new EasJsonReader(projectDir);
  if (type === 'build') {
    return await easJsonReader.getBuildProfileNamesAsync();
  } else {
    return await easJsonReader.getSubmitProfileNamesAsync();
  }
}
