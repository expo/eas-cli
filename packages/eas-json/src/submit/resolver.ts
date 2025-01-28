import { Platform } from '@expo/eas-build-job';
import envString from 'env-string';

import { AndroidSubmitProfileSchema, ResolvedIosSubmitProfileSchema } from './schema';
import {
  AndroidSubmitProfileFieldsToEvaluate,
  IosSubmitProfileFieldsToEvaluate,
  SubmitProfile,
} from './types';
import { MissingParentProfileError, MissingProfileError } from '../errors';
import { EasJson } from '../types';

export function resolveSubmitProfile<T extends Platform>({
  easJson,
  platform,
  profileName,
}: {
  easJson: EasJson;
  platform: T;
  profileName?: string;
}): SubmitProfile<T> {
  try {
    const submitProfile = resolveProfile({
      easJson,
      platform,
      profileName: profileName ?? 'production',
    });
    const unevaluatedProfile = mergeProfiles(getDefaultProfile(platform), submitProfile);
    return evaluateFields(platform, unevaluatedProfile);
  } catch (err: any) {
    if (err instanceof MissingProfileError && !profileName) {
      return getDefaultProfile(platform);
    } else {
      throw err;
    }
  }
}

function resolveProfile<T extends Platform>({
  easJson,
  profileName,
  depth = 0,
  platform,
}: {
  platform: T;
  easJson: EasJson;
  profileName: string;
  depth?: number;
}): SubmitProfile<T> | undefined {
  if (depth >= 5) {
    throw new Error(
      'Too long chain of profile extensions, make sure "extends" keys do not make a cycle'
    );
  }

  const profile = easJson.submit?.[profileName];
  if (!profile) {
    if (depth === 0) {
      throw new MissingProfileError(`Missing submit profile in eas.json: ${profileName}`);
    } else {
      throw new MissingParentProfileError(
        `Extending non-existent submit profile in eas.json: ${profileName}`
      );
    }
  }

  const { extends: baseProfileName, ...rest } = profile;
  const platformProfile = rest[platform] as SubmitProfile<T> | undefined;
  if (baseProfileName) {
    const baseProfile = resolveProfile({
      easJson,
      platform,
      profileName: baseProfileName,
      depth: depth + 1,
    });
    return mergeProfiles(baseProfile, platformProfile);
  } else {
    return platformProfile;
  }
}

function mergeProfiles<T extends Platform>(
  base: SubmitProfile<T>,
  update?: SubmitProfile<T>
): SubmitProfile<T>;
function mergeProfiles<T extends Platform>(
  base?: SubmitProfile<T>,
  update?: SubmitProfile<T>
): SubmitProfile<T> | undefined;
function mergeProfiles<T extends Platform>(
  base?: SubmitProfile<T>,
  update?: SubmitProfile<T>
): SubmitProfile<T> | undefined {
  if (!update) {
    return base;
  }
  return { ...base, ...update };
}

export function getDefaultProfile<T extends Platform>(platform: T): SubmitProfile<T> {
  const Schema =
    platform === Platform.ANDROID ? AndroidSubmitProfileSchema : ResolvedIosSubmitProfileSchema;
  return Schema.validate({}, { allowUnknown: false, abortEarly: false, convert: true }).value;
}

function evaluateFields<T extends Platform>(
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
