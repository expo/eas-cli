import { Platform } from '@expo/eas-build-job';
import {
  BuildProfile,
  EasJsonAccessor,
  EasJsonUtils,
  ProfileType,
  SubmitProfile,
} from '@expo/eas-json';
import fs from 'fs-extra';
import path from 'path';

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
  projectDir,
}: {
  easJsonAccessor: EasJsonAccessor;
  platforms: Platform[];
  profileName?: string;
  projectDir: string;
  type: T;
}): Promise<ProfileData<T>[]> {
  const results = platforms.map(async function (platform) {
    const profile = await readProfileWithOverridesAsync({
      easJsonAccessor,
      platform,
      type,
      profileName,
      projectDir,
    });

    return {
      profile,
      profileName: profileName ?? 'production',
      platform,
    };
  });

  return await Promise.all(results);
}

async function maybeSetNodeVersionFromFileAsync(
  projectDir: string,
  profile: BuildProfile<Platform>
): Promise<void> {
  if (profile?.node) {
    return;
  }
  const nodeVersion = await getNodeVersionFromFileAsync(projectDir);
  if (nodeVersion) {
    Log.log(
      `The EAS build profile does not specify a Node.js version. Using the version specified in .nvmrc: ${nodeVersion} `
    );

    profile.node = nodeVersion;
  }
}

async function getNodeVersionFromFileAsync(projectDir: string): Promise<string | undefined> {
  const nvmrcPath = path.join(projectDir, '.nvmrc');
  if (!(await fs.pathExists(nvmrcPath))) {
    return;
  }

  let nodeVersion: string;
  try {
    nodeVersion = (await fs.readFile(nvmrcPath, 'utf8')).toString().trim();
  } catch {
    return undefined;
  }
  return nodeVersion;
}

async function readProfileWithOverridesAsync<T extends ProfileType>({
  easJsonAccessor,
  platform,
  type,
  profileName,
  projectDir,
}: {
  easJsonAccessor: EasJsonAccessor;
  platform: Platform;
  type: T;
  profileName?: string;
  projectDir: string;
}): Promise<EasProfile<T>> {
  if (type === 'build') {
    const buildProfile = await EasJsonUtils.getBuildProfileAsync(
      easJsonAccessor,
      platform,
      profileName
    );

    await maybePrintBuildProfileDeprecationWarningsAsync(easJsonAccessor, platform, profileName);
    await maybeSetNodeVersionFromFileAsync(projectDir, buildProfile);

    return buildProfile as EasProfile<T>;
  } else {
    return (await EasJsonUtils.getSubmitProfileAsync(
      easJsonAccessor,
      platform,
      profileName
    )) as EasProfile<T>;
  }
}

let hasPrintedDeprecationWarnings = false;

/**
 * Only for testing purposes
 */
export function clearHasPrintedDeprecationWarnings(): void {
  hasPrintedDeprecationWarnings = false;
}

export async function maybePrintBuildProfileDeprecationWarningsAsync(
  easJsonAccessor: EasJsonAccessor,
  platform: Platform,
  profileName?: string
): Promise<void> {
  if (hasPrintedDeprecationWarnings) {
    return;
  }
  const deprecationWarnings = await EasJsonUtils.getBuildProfileDeprecationWarningsAsync(
    easJsonAccessor,
    platform,
    profileName ?? 'production'
  );
  if (deprecationWarnings.length === 0) {
    return;
  }
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
  hasPrintedDeprecationWarnings = true;
}
