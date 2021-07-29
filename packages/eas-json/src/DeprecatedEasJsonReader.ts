import { Platform, Workflow } from '@expo/eas-build-job';
import fs from 'fs-extra';
import path from 'path';

import {
  AndroidBuildProfile,
  BuildProfile,
  EasConfig,
  IosBuildProfile,
} from './DeprecatedConfig.types';
import { EasJsonSchema, schemaBuildProfileMap } from './DeprecatedEasJsonSchema';

export interface EasJson {
  builds: {
    android?: { [key: string]: BuildProfilePreValidation };
    ios?: { [key: string]: BuildProfilePreValidation };
  };
}

interface BuildProfilePreValidation {
  workflow?: Workflow;
  extends?: string;
}

function intersect<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  return new Set([...setA].filter(i => setB.has(i)));
}

export class EasJsonReader {
  constructor(private projectDir: string, private platform: 'android' | 'ios' | 'all') {}

  /**
   * Return build profile names for a particular platform.
   * If platform is 'all', return common build profiles for all platforms
   */
  public async getBuildProfileNamesAsync(): Promise<string[]> {
    const easJson = await this.readRawAsync();
    if (this.platform === 'android') {
      return Object.keys(easJson?.builds?.android ?? {});
    } else if (this.platform === 'ios') {
      return Object.keys(easJson?.builds?.ios ?? {});
    } else {
      const intersectingProfileNames = intersect(
        new Set(Object.keys(easJson?.builds?.ios ?? {})),
        new Set(Object.keys(easJson?.builds?.android ?? {}))
      );
      return Array.from(intersectingProfileNames);
    }
  }

  public async readAsync(buildProfileName: string): Promise<EasConfig> {
    const easJson = await this.readRawAsync();

    let androidConfig;
    if (['android', 'all'].includes(this.platform)) {
      androidConfig = this.validateBuildProfile<AndroidBuildProfile>(
        Platform.ANDROID,
        buildProfileName,
        easJson.builds?.android || {}
      );
    }
    let iosConfig;
    if (['ios', 'all'].includes(this.platform)) {
      iosConfig = this.validateBuildProfile<IosBuildProfile>(
        Platform.IOS,
        buildProfileName,
        easJson.builds?.ios || {}
      );
    }
    return {
      builds: {
        ...(androidConfig ? { android: androidConfig } : {}),
        ...(iosConfig ? { ios: iosConfig } : {}),
      },
    };
  }

  public async validateAsync(): Promise<void> {
    const easJson = await this.readRawAsync();

    const androidProfiles = easJson.builds?.android ?? {};
    for (const name of Object.keys(androidProfiles)) {
      try {
        this.validateBuildProfile(Platform.ANDROID, name, androidProfiles);
      } catch (err) {
        err.msg = `Failed to validate Android build profile "${name}"\n${err.msg}`;
        throw err;
      }
    }
    const iosProfiles = easJson.builds?.ios ?? {};
    for (const name of Object.keys(iosProfiles)) {
      try {
        this.validateBuildProfile(Platform.IOS, name, iosProfiles);
      } catch (err) {
        err.msg = `Failed to validate iOS build profile "${name}"\n${err.msg}`;
        throw err;
      }
    }
  }

  public async readRawAsync(): Promise<EasJson> {
    const rawFile = await fs.readFile(path.join(this.projectDir, 'eas.json'), 'utf8');
    const json = JSON.parse(rawFile);

    const { value, error } = EasJsonSchema.validate(json, {
      abortEarly: false,
    });

    if (error) {
      throw new Error(`eas.json is not valid [${error.toString()}]`);
    }
    return value;
  }

  private validateBuildProfile<T extends BuildProfile>(
    platform: Platform,
    buildProfileName: string,
    buildProfiles: Record<string, BuildProfilePreValidation>
  ): T {
    const buildProfile = this.resolveBuildProfile(platform, buildProfileName, buildProfiles);
    const schema = schemaBuildProfileMap[platform];
    const { value, error } = schema.validate(buildProfile, {
      stripUnknown: true,
      convert: true,
      abortEarly: false,
    });

    if (error) {
      throw new Error(
        `Object "${platform}.${buildProfileName}" in eas.json is not valid [${error.toString()}]`
      );
    }
    return value;
  }

  private resolveBuildProfile(
    platform: Platform,
    buildProfileName: string,
    buildProfiles: Record<string, BuildProfilePreValidation>,
    depth: number = 0
  ): Record<string, any> {
    if (depth >= 2) {
      throw new Error(
        'Too long chain of build profile extensions, make sure "extends" keys do not make a cycle'
      );
    }
    const buildProfile = buildProfiles[buildProfileName];
    if (!buildProfile) {
      throw new Error(`There is no profile named ${buildProfileName} for platform ${platform}`);
    }
    const { extends: baseProfileName, ...buildProfileRest } = buildProfile;
    if (baseProfileName) {
      return deepMerge(
        this.resolveBuildProfile(platform, baseProfileName, buildProfiles, depth + 1),
        buildProfileRest
      );
    } else {
      return buildProfileRest;
    }
  }
}

function isObject(value: any): boolean {
  return typeof value === 'object' && value !== null;
}

export function deepMerge(
  base: Record<string, any>,
  update: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  Object.keys(base).forEach(key => {
    const oldValue = base[key];
    const newValue = update[key];
    if (isObject(newValue) && isObject(oldValue)) {
      result[key] = deepMerge(oldValue, newValue);
    } else if (newValue !== undefined) {
      result[key] = isObject(newValue) ? deepMerge({}, newValue) : newValue;
    } else {
      result[key] = isObject(oldValue) ? deepMerge({}, oldValue) : oldValue;
    }
  });
  Object.keys(update).forEach(key => {
    const newValue = update[key];
    if (result[key] === undefined) {
      result[key] = isObject(newValue) ? deepMerge({}, newValue) : newValue;
    }
  });
  return result;
}
