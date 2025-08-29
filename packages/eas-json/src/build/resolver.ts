import { Platform } from '@expo/eas-build-job';

import { MissingParentProfileError, MissingProfileError } from '../errors';
import { EasJson } from '../types';
import { BuildProfileSchema } from './schema';
import { BuildProfile, CommonBuildProfile, EasJsonBuildProfile } from './types';

type EasJsonBuildProfileResolved = Omit<EasJsonBuildProfile, 'extends'>;

export function resolveBuildProfile<T extends Platform>({
  easJson,
  platform,
  profileName,
}: {
  easJson: EasJson;
  platform: T;
  profileName?: string;
}): BuildProfile<T> {
  const easJsonProfile = resolveProfile({
    easJson,
    profileName: profileName ?? 'production',
  });
  const { android, ios, ...base } = easJsonProfile;
  const withoutDefaults = mergeProfiles(
    base,
    (easJsonProfile[platform] as EasJsonBuildProfileResolved) ?? {}
  );
  return mergeProfiles(getDefaultProfile(platform), withoutDefaults) as BuildProfile<T>;
}

function resolveProfile({
  easJson,
  profileName,
  depth = 0,
}: {
  easJson: EasJson;
  profileName: string;
  depth?: number;
}): EasJsonBuildProfileResolved {
  if (depth >= 5) {
    throw new Error(
      'Too long chain of profile extensions, make sure "extends" keys do not make a cycle'
    );
  }

  const profile = easJson.build?.[profileName];
  if (!profile) {
    if (depth === 0) {
      throw new MissingProfileError(
        `Missing build profile in eas.json: "${profileName}". Available profiles: [${Object.keys(
          easJson.build ?? {}
        )
          .map(profile => `"${profile}"`)
          .join(', ')}]`
      );
    } else {
      throw new MissingParentProfileError(
        `Extending non-existent build profile in eas.json: "${profileName}"`
      );
    }
  }

  const { extends: baseProfileName, ...rest } = profile;
  if (baseProfileName) {
    const baseProfile = resolveProfile({
      easJson,
      profileName: baseProfileName,
      depth: depth + 1,
    });
    return mergeProfiles(baseProfile, rest);
  } else {
    return rest;
  }
}

function mergeProfiles(
  base: EasJsonBuildProfileResolved,
  update: EasJsonBuildProfileResolved
): EasJsonBuildProfileResolved {
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

  if (update?.cache?.disabled) {
    delete result.ios?.cache;
    delete result.android?.cache;
    result.cache = {
      disabled: true,
    } as CommonBuildProfile['cache'];
  }

  for (const [key, newValue] of Object.entries(update ?? [])) {
    for (const platform of [Platform.ANDROID, Platform.IOS]) {
      const platformConfig = base?.[platform];
      // @ts-expect-error 'string' can't be used to index type...
      const existingValue = platformConfig?.[key];
      if (existingValue !== undefined) {
        throw new Error(
          `Cannot override platform-specific base value ${JSON.stringify(
            existingValue
          )} by value ${JSON.stringify(
            newValue
          )} for key "${key}". Move the entry out of the "${platform}" object, into the common properties, if you want to override it.`
        );
      }
    }
  }

  if (base.android && update.android) {
    result.android = mergeProfiles(
      base.android as EasJsonBuildProfileResolved,
      update.android as EasJsonBuildProfileResolved
    );
  }
  if (base.ios && update.ios) {
    result.ios = mergeProfiles(
      base.ios as EasJsonBuildProfileResolved,
      update.ios as EasJsonBuildProfileResolved
    );
  }
  return result;
}

function getDefaultProfile<T extends Platform>(platform: T): EasJsonBuildProfile {
  const defaultProfile = BuildProfileSchema.validate(
    {},
    { allowUnknown: false, abortEarly: false, convert: true }
  ).value;
  const { android, ios, ...base } = defaultProfile;
  return mergeProfiles(base, defaultProfile[platform]);
}
