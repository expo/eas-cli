import { Platform } from '@expo/eas-build-job';
import { isEmailValid } from '@hapi/address';
import { validate } from 'uuid';

import { EasJsonAccessor } from './accessor';
import { resolveBuildProfile } from './build/resolver';
import { BuildProfile } from './build/types';
import { MissingEasJsonError } from './errors';
import { resolveSubmitProfile } from './submit/resolver';
import { SubmitProfile } from './submit/types';
import { EasJson } from './types';

const ASC_API_KEY_ID_REGEX = /^[\dA-Z]{10}$/;
const APPLE_TEAM_ID_REGEX = /^[\dA-Z]{10}$/;
const ASC_APP_ID_REGEX = /^\d{10}$/;

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

  public static validateSubmitProfile<T extends Platform>(
    profile: SubmitProfile<T>,
    platform: T
  ): void {
    if (platform === Platform.IOS) {
      const iosProfile = profile as SubmitProfile<Platform.IOS>;

      if (iosProfile.ascApiKeyId && !ASC_API_KEY_ID_REGEX.test(iosProfile.ascApiKeyId)) {
        throw new Error(
          `Invalid Apple App Store Connect API Key ID was specified. It should contain 10 letters or digits. Example: "AB32CDE81F". Learn more: https://expo.fyi/creating-asc-api-key.`
        );
      }
      if (iosProfile.appleTeamId && !APPLE_TEAM_ID_REGEX.test(iosProfile.appleTeamId)) {
        throw new Error(
          `Invalid Apple Team ID was specified. It should contain 10 letters or digits. Example: "AB32CDE81F".`
        );
      }
      if (iosProfile.ascAppId && !ASC_APP_ID_REGEX.test(iosProfile.ascAppId)) {
        throw new Error(
          `Invalid Apple App Store Connect App ID was specified. It should contain 10 digits. Example: "1234567891". Learn more: https://expo.fyi/asc-app-id.md.`
        );
      }
      if (iosProfile.ascApiKeyIssuerId && !validate(iosProfile.ascApiKeyIssuerId)) {
        throw new Error(
          `Invalid Apple App Store Connect API Key Issuer ID was specified. It should be a valid UUID. Example: "123e4567-e89b-12d3-a456-426614174000". Learn more: https://expo.fyi/creating-asc-api-key.`
        );
      }
      if (iosProfile.appleId && !isEmailValid(iosProfile.appleId)) {
        throw new Error(
          `Invalid Apple ID was specified. It should be a valid email address. Example: "name@domain.com".`
        );
      }
    }
  }

  public static async getSubmitProfileAsync<T extends Platform>(
    accessor: EasJsonAccessor,
    platform: T,
    profileName?: string
  ): Promise<SubmitProfile<T>> {
    const easJson = await accessor.readAsync();
    const profile = resolveSubmitProfile({ easJson, platform, profileName });
    this.validateSubmitProfile(profile, platform);
    return profile;
  }
}
