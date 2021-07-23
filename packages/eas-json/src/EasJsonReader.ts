import { Platform } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import {
  AndroidBuildProfile,
  BuildProfile,
  CredentialsSource,
  EasJson,
  IosBuildProfile,
  RawBuildProfile,
} from './EasJson.types';
import { EasJsonSchema, MinimalEasJsonSchema } from './EasJsonSchema';

interface EasJsonPreValidation {
  build: { [profile: string]: object };
}

const defaults = {
  distribution: 'store',
  credentialsSource: CredentialsSource.REMOTE,
} as const;

export class EasJsonReader {
  public static formatEasJsonPath(projectDir: string) {
    return path.join(projectDir, 'eas.json');
  }

  constructor(private projectDir: string) {}

  /**
   * Return build profile names for a particular platform.
   * If platform is 'all', return common build profiles for all platforms
   */
  public async getBuildProfileNamesAsync(): Promise<string[]> {
    const easJson = await this.readRawAsync();
    return Object.keys(easJson?.build ?? {});
  }

  public async readAndroidBuildProfileAsync(
    buildProfileName: string
  ): Promise<AndroidBuildProfile> {
    const easJson = await this.readAndValidateAsync();
    this.checkProfile(easJson, buildProfileName);
    const {
      android: resolvedAndroidSpecifcicValues,
      ios,
      ...resolvedProfile
    } = this.resolveBuildProfile(easJson, buildProfileName);
    const profileWithoutDefaults = profileMerge(
      resolvedProfile,
      resolvedAndroidSpecifcicValues ?? {}
    );
    return profileMerge(defaults, profileWithoutDefaults) as AndroidBuildProfile;
  }

  public async readIosBuildProfileAsync(buildProfileName: string): Promise<IosBuildProfile> {
    const easJson = await this.readAndValidateAsync();
    this.checkProfile(easJson, buildProfileName);
    const {
      android,
      ios: resolvedIosSpecifcicValues,
      ...resolvedProfile
    } = this.resolveBuildProfile(easJson, buildProfileName);
    const profileWithoutDefaults = profileMerge(resolvedProfile, resolvedIosSpecifcicValues ?? {});
    return profileMerge(defaults, profileWithoutDefaults) as IosBuildProfile;
  }

  public async readBuildProfileAsync(
    buildProfileName: string,
    platform: Platform
  ): Promise<BuildProfile> {
    if (platform === Platform.ANDROID) {
      return await this.readAndroidBuildProfileAsync(buildProfileName);
    } else if (platform === Platform.IOS) {
      return await this.readIosBuildProfileAsync(buildProfileName);
    } else {
      throw new Error(`Unknown platform ${platform}`);
    }
  }

  public async readAndValidateAsync(): Promise<EasJson> {
    const easJson = await this.readRawAsync();
    const { value, error } = EasJsonSchema.validate(easJson, {
      allowUnknown: false,
      convert: true,
      abortEarly: false,
    });

    if (error) {
      throw new Error(`eas.json is not valid [${error.toString()}]`);
    }
    return value as EasJson;
  }

  public async readRawAsync(): Promise<EasJsonPreValidation> {
    const rawFile = await fs.readFile(EasJsonReader.formatEasJsonPath(this.projectDir), 'utf8');
    const json = JSON.parse(rawFile);

    const { value, error } = MinimalEasJsonSchema.validate(json, {
      abortEarly: false,
    });

    if (error) {
      throw new Error(`eas.json is not valid [${error.toString()}]`);
    }
    return value;
  }

  private resolveBuildProfile(
    easJson: EasJson,
    profileName: string,
    depth: number = 0
  ): RawBuildProfile {
    if (depth >= 2) {
      throw new Error(
        'Too long chain of build profile extensions, make sure "extends" keys do not make a cycle'
      );
    }
    const buildProfile = easJson.build[profileName];
    if (!buildProfile) {
      throw new Error(`There is no profile named ${profileName}`);
    }
    const { extends: baseProfileName, ...buildProfileRest } = buildProfile;
    if (baseProfileName) {
      return profileMerge(
        this.resolveBuildProfile(easJson, baseProfileName, depth + 1),
        buildProfileRest
      );
    } else {
      return buildProfileRest;
    }
  }

  private checkProfile(easJson: EasJson, profileName: string) {
    if (!easJson.build || !easJson.build[profileName]) {
      throw new Error(`There is no profile named ${profileName} in eas.json.`);
    }
  }
}

export function profileMerge(base: RawBuildProfile, update: RawBuildProfile): RawBuildProfile {
  const result = {
    ...base,
    ...update,
  };
  if (base.env && update.env) {
    result.env = {
      ...base.env,
      ...update.env,
    };
  }
  if (base.android && update.android) {
    result.android = profileMerge(base.android, update.android);
  }
  if (base.ios && update.ios) {
    result.ios = profileMerge(base.ios, update.ios);
  }
  return result;
}
