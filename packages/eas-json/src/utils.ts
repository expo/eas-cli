import { Platform } from '@expo/eas-build-job';

import { EasJsonAccessor } from './accessor';
import { resolveBuildProfile } from './build/resolver';
import { BuildProfile } from './build/types';
import { MissingEasJsonError } from './errors';
import { resolveSubmitProfile } from './submit/resolver';
import { SubmitProfile } from './submit/types';
import { EasJson } from './types';

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

  public static getBuildProfileDepreactionWarnings(
    buildProfile: BuildProfile,
    profileName?: string
  ): { message: string[]; docsUrl?: string }[] {
    const warnings: { message: string[]; docsUrl?: string }[] = [];

    if (buildProfile.cache?.cacheDefaultPaths !== undefined) {
      warnings.push({
        message: [
          `The "build.${
            profileName ?? 'production'
          }.cache.cacheDefaultPaths" field in eas.json is deprecated and will be removed in the future.`,
          `You can use "build.${
            profileName ?? 'production'
          }.cache.cachePaths" to manually select which paths you want to cache.`,
        ],
        docsUrl: 'https://docs.expo.dev/build-reference/caching/#ios-dependencies',
      });
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
    return resolveSubmitProfile({ easJson, platform, profileName });
  }
}
