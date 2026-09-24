import { Platform } from '@expo/eas-build-job';

import { EasJsonAccessor } from './accessor';
import { resolveBuildProfile } from './build/resolver';
import { BuildProfile } from './build/types';
import { MissingEasJsonError } from './errors';
import { resolveSubmitProfile } from './submit/resolver';
import { AndroidSubmitProfileSchema, ResolvedIosSubmitProfileSchema } from './submit/schema';
import { SubmitProfile } from './submit/types';
import { EasJson } from './types';

interface EasJsonDeprecationWarning {
  message: string[];
  docsUrl?: string;
}

export class EasJsonUtils {
  public static async getBuildProfileNamesAsync(accessor: EasJsonAccessor): Promise<string[]> {
    const easJson = await accessor.readAsync();
    return Object.keys(easJson?.build ?? {});
  }

  public static async getBuildProfileAsync<T extends Platform>(
    accessor: EasJsonAccessor,
    platform: T,
    profileName?: string
  ): Promise<BuildProfile<T>> {
    const easJson = await accessor.readAsync();
    return resolveBuildProfile({ easJson, platform, profileName });
  }

  public static async getBuildProfileDeprecationWarningsAsync(
    easJsonAccessor: EasJsonAccessor,
    platform: Platform,
    profileName: string
  ): Promise<EasJsonDeprecationWarning[]> {
    const warnings: EasJsonDeprecationWarning[] = [];
    const buildProfile = await EasJsonUtils.getBuildProfileAsync(
      easJsonAccessor,
      platform,
      profileName
    );
    const rawEasJson = await easJsonAccessor.readRawJsonAsync();

    if (buildProfile.cache?.cacheDefaultPaths !== undefined) {
      warnings.push({
        message: [
          `The "build.${profileName}.cache.cacheDefaultPaths" field in eas.json is deprecated and will be removed in the future.`,
        ],
        docsUrl: 'https://docs.expo.dev/build-reference/caching/#ios-dependencies',
      });
    }

    if (buildProfile.expoCli) {
      warnings.push({
        message: [
          `The "build.${profileName}.expoCli" field in eas.json is deprecated and will be removed in the future.`,
          `Global Expo CLI is deprecated. Since Expo SDK 46 local Expo CLI shipped with "expo" package is used. Remove this field from eas.json.`,
          `Using this field has no effect on EAS Build process.`,
        ],
      });
    }

    warnings.push(...EasJsonUtils.getCustomPathsDeprecationWarnings(rawEasJson, profileName));

    return warnings;
  }

  private static getCustomPathsDeprecationWarnings(
    rawEasJson: any,
    profileName: string
  ): EasJsonDeprecationWarning[] {
    const warnings: EasJsonDeprecationWarning[] = [];
    if (rawEasJson.build?.[profileName]?.cache?.customPaths !== undefined) {
      warnings.push({
        message: [
          `The "build.${profileName}.cache.customPaths" field in eas.json is deprecated and will be removed in the future. Please use "build.${profileName}.cache.paths" instead.`,
        ],
        docsUrl: 'https://docs.expo.dev/build-reference/eas-json/#cache',
      });
    }
    if (rawEasJson.build?.[profileName]?.extends !== undefined) {
      warnings.push(
        ...EasJsonUtils.getCustomPathsDeprecationWarnings(
          rawEasJson,
          rawEasJson.build?.[profileName].extends
        )
      );
    }
    return warnings;
  }

  public static async getCliConfigAsync(accessor: EasJsonAccessor): Promise<EasJson['cli'] | null> {
    try {
      const easJson = await accessor.readAsync();
      return easJson.cli ?? null;
    } catch (err: any) {
      if (err instanceof MissingEasJsonError) {
        return null;
      }
      throw err;
    }
  }

  public static async getSubmitProfileNamesAsync(accessor: EasJsonAccessor): Promise<string[]> {
    const easJson = await accessor.readAsync();
    return Object.keys(easJson?.submit ?? {});
  }

  public static async getSubmitProfileAsync<T extends Platform>(
    accessor: EasJsonAccessor,
    platform: T,
    profileName?: string
  ): Promise<SubmitProfile<T>> {
    const easJson = await accessor.readAsync();
    const profile = resolveSubmitProfile({ easJson, platform, profileName });
    const Schema =
      platform === Platform.ANDROID ? AndroidSubmitProfileSchema : ResolvedIosSubmitProfileSchema;
    const { value, error } = Schema.validate(profile, {
      allowUnknown: false,
      abortEarly: false,
      convert: true,
    });
    if (error) {
      throw error;
    }
    return value;
  }
}
