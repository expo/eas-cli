import { Platform } from '@expo/eas-build-job';
import JsonFile from '@expo/json-file';
import chalk from 'chalk';
import envString from 'env-string';
import logSymbols from 'log-symbols';
import path from 'path';

import { BuildProfile } from './EasBuild.types';
import { CredentialsSource, EasJson, RawBuildProfile } from './EasJson.types';
import {
  AndroidSubmitProfileSchema,
  EasJsonSchema,
  IosSubmitProfileSchema,
  MinimalEasJsonSchema,
} from './EasJsonSchema';
import {
  AndroidSubmitProfileFieldsToEvaluate,
  IosSubmitProfileFieldsToEvaluate,
  SubmitProfile,
} from './EasSubmit.types';
import { InvalidEasJsonError } from './errors';

interface EasJsonPreValidation {
  build: { [profile: string]: object };
  submit?: { [profile: string]: object };
}

const defaults = {
  distribution: 'store',
  credentialsSource: CredentialsSource.REMOTE,
} as const;

type LoggerFn = (...args: any[]) => void;

interface Logger {
  log: LoggerFn;
  warn: LoggerFn;
}

export class EasJsonReader {
  private static log?: Logger;

  public static formatEasJsonPath(projectDir: string): string {
    return path.join(projectDir, 'eas.json');
  }

  public static setLog(log: Logger): void {
    this.log = log;
  }

  constructor(private projectDir: string) {}

  public async getBuildProfileNamesAsync(): Promise<string[]> {
    const easJson = await this.readRawAsync();
    return Object.keys(easJson?.build ?? {});
  }

  public async getSubmitProfileNamesAsync({ throwIfEasJsonDoesNotExist = true } = {}): Promise<
    string[]
  > {
    try {
      const easJson = await this.readRawAsync();
      return Object.keys(easJson?.submit ?? {});
    } catch (err: any) {
      if (!throwIfEasJsonDoesNotExist && err.code === 'ENOENT') {
        return [];
      } else {
        throw err;
      }
    }
  }

  public async readBuildProfileAsync<T extends Platform>(
    platform: T,
    profileName: string
  ): Promise<BuildProfile<T>> {
    const easJson = await this.readAndValidateAsync();
    this.ensureBuildProfileExists(easJson, profileName);
    const {
      android: resolvedAndroidSpecificValues,
      ios: resolvedIosSpecificValues,
      ...resolvedProfile
    } = this.resolveBuildProfile(easJson, profileName);
    if (platform === Platform.ANDROID) {
      const profileWithoutDefaults = profileMerge(
        resolvedProfile,
        resolvedAndroidSpecificValues ?? {}
      );
      const profile = profileMerge(defaults, profileWithoutDefaults) as BuildProfile<T>;
      this.handleDeprecatedFields(profile);
      return profile;
    } else if (platform === Platform.IOS) {
      const profileWithoutDefaults = profileMerge(resolvedProfile, resolvedIosSpecificValues ?? {});
      const profile = profileMerge(defaults, profileWithoutDefaults) as BuildProfile<T>;
      this.handleDeprecatedFields(profile);
      return profile;
    } else {
      throw new Error(`Unknown platform ${platform}`);
    }
  }

  public async readSubmitProfileAsync<T extends Platform>(
    platform: T,
    profileNameArg?: string
  ): Promise<SubmitProfile<T>> {
    let profileName = profileNameArg;

    if (!profileName) {
      const profileNames = await this.getSubmitProfileNamesAsync({
        throwIfEasJsonDoesNotExist: false,
      });

      if (profileNames.includes('production')) {
        profileName = 'production';
      } else if (profileNames.includes('release')) {
        profileName = 'release';
      } else {
        return getDefaultSubmitProfile(platform);
      }
    }

    const easJson = await this.readAndValidateAsync();
    const profile = easJson?.submit?.[profileName];
    if (!profile) {
      throw new Error(`There is no profile named ${profileName} in eas.json`);
    }
    const platformProfile = profile[platform];
    if (platformProfile) {
      return this.evaluateFields(platform, platformProfile as SubmitProfile<T>);
    } else {
      return getDefaultSubmitProfile(platform);
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
      throw new InvalidEasJsonError(`eas.json is not valid [${error.toString()}]`);
    }
    return value as EasJson;
  }

  public async readRawAsync(): Promise<EasJsonPreValidation> {
    try {
      const easJsonPath = EasJsonReader.formatEasJsonPath(this.projectDir);
      const rawEasJson = JsonFile.read(easJsonPath);
      const { value, error } = MinimalEasJsonSchema.validate(rawEasJson, { abortEarly: false });
      if (error) {
        throw new InvalidEasJsonError(`eas.json is not valid [${error.toString()}]`);
      }
      return value;
    } catch (err: any) {
      if (err.code === 'EJSONPARSE') {
        err.message = `Found invalid JSON in eas.json. ${err.message}`;
      }
      throw err;
    }
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
      throw new Error(`There is no profile named ${profileName} in eas.json`);
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

  private ensureBuildProfileExists(easJson: EasJson, profileName: string): void {
    if (!easJson.build || !easJson.build[profileName]) {
      throw new Error(`There is no profile named ${profileName} in eas.json`);
    }
  }

  private evaluateFields<T extends Platform>(
    platform: T,
    profile: SubmitProfile<T>
  ): SubmitProfile<T> {
    const fields =
      platform === Platform.ANDROID
        ? AndroidSubmitProfileFieldsToEvaluate
        : IosSubmitProfileFieldsToEvaluate;
    const evaluatedProfile = { ...profile };
    for (const field of fields) {
      if (field in evaluatedProfile) {
        // @ts-ignore
        evaluatedProfile[field] = envString(evaluatedProfile[field], process.env);
      }
    }
    return evaluatedProfile;
  }

  private handleDeprecatedFields<T extends Platform>(profile: BuildProfile<T>): void {
    if (profile.developmentClient) {
      EasJsonReader.log?.warn(
        `${logSymbols.warning} eas.json validation: ${chalk.bold(
          'developmentClient'
        )} is deprecated, use ${chalk.bold('useDevelopmentClient')} instead`
      );
      profile.useDevelopmentClient = true;
      delete profile.developmentClient;
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

function getDefaultSubmitProfile<T extends Platform>(platform: T): SubmitProfile<T> {
  const Schema =
    platform === Platform.ANDROID ? AndroidSubmitProfileSchema : IosSubmitProfileSchema;
  return Schema.validate({}, { convert: true }).value;
}
