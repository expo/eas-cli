import { Platform } from '@expo/eas-build-job';
import { ResourceClass } from '@expo/eas-json';
import chalk from 'chalk';
import semver from 'semver';

import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { BuildResourceClass } from '../../graphql/generated';
import Log from '../../log';
import { ProfileData } from '../../utils/profiles';
import { getReactNativeVersionAsync } from '../metadata';

const iosResourceClassToBuildResourceClassMapping: Record<ResourceClass, BuildResourceClass> = {
  [ResourceClass.DEFAULT]: BuildResourceClass.IosDefault,
  [ResourceClass.LARGE]: BuildResourceClass.IosLarge,
  [ResourceClass.M1_EXPERIMENTAL]: BuildResourceClass.IosM1Large,
  [ResourceClass.M1_MEDIUM]: BuildResourceClass.IosM1Medium,
  [ResourceClass.M1_LARGE]: BuildResourceClass.IosM1Large,
  [ResourceClass.INTEL_MEDIUM]: BuildResourceClass.IosIntelMedium,
  [ResourceClass.MEDIUM]: BuildResourceClass.IosMedium,
};

const androidResourceClassToBuildResourceClassMapping: Record<
  Exclude<
    ResourceClass,
    | ResourceClass.M1_EXPERIMENTAL
    | ResourceClass.M1_MEDIUM
    | ResourceClass.M1_LARGE
    | ResourceClass.INTEL_MEDIUM
  >,
  BuildResourceClass
> = {
  [ResourceClass.DEFAULT]: BuildResourceClass.AndroidDefault,
  [ResourceClass.LARGE]: BuildResourceClass.AndroidLarge,
  [ResourceClass.MEDIUM]: BuildResourceClass.AndroidMedium,
};

async function resolveDefaultResourceFlagAsync(
  platform: Platform,
  buildProfile: ProfileData<'build'>,
  projectDir: string,
  getDynamicProjectConfigAsync: DynamicConfigContextFn
): Promise<ResourceClass> {
  const { exp } = await getDynamicProjectConfigAsync({ env: buildProfile.profile.env });
  const { sdkVersion } = exp;
  const reactNativeVersion = await getReactNativeVersionAsync(projectDir);
  return platform === Platform.IOS
    ? resolveIosDefaultRequestedResourceClass(sdkVersion, reactNativeVersion)
    : ResourceClass.DEFAULT;
}

function resolveIosDefaultRequestedResourceClass(
  sdkVersion?: string,
  reactNativeVersion?: string
): ResourceClass {
  if (
    (sdkVersion && semver.satisfies(sdkVersion, '>=48')) ||
    (reactNativeVersion && semver.satisfies(reactNativeVersion, '>=0.71.0'))
  ) {
    return ResourceClass.M1_MEDIUM;
  } else {
    return ResourceClass.DEFAULT;
  }
}

export async function resolveBuildResourceClassAsync(
  profile: ProfileData<'build'>,
  projectDir: string,
  getDynamicProjectConfigAsync: DynamicConfigContextFn,
  resourceClassFlag?: ResourceClass
): Promise<BuildResourceClass> {
  if (
    profile.platform !== Platform.IOS &&
    resourceClassFlag &&
    [
      ResourceClass.M1_EXPERIMENTAL,
      ResourceClass.M1_MEDIUM,
      ResourceClass.M1_LARGE,
      ResourceClass.INTEL_MEDIUM,
    ].includes(resourceClassFlag)
  ) {
    throw new Error(`Resource class ${resourceClassFlag} is only available for iOS builds`);
  }

  const profileResourceClass = profile.profile.resourceClass;
  if (profileResourceClass && resourceClassFlag && resourceClassFlag !== profileResourceClass) {
    Log.warn(
      `Build profile specifies the "${profileResourceClass}" resource class but you passed "${resourceClassFlag}" to --resource-class.\nUsing the  "${resourceClassFlag}" as the override.`
    );
  }

  const resourceClass =
    resourceClassFlag ??
    profileResourceClass ??
    (await resolveDefaultResourceFlagAsync(
      profile.platform,
      profile,
      projectDir,
      getDynamicProjectConfigAsync
    ));

  if (profile.platform === Platform.IOS && resourceClass === ResourceClass.M1_EXPERIMENTAL) {
    Log.warn(`Resource class ${chalk.bold('m1-experimental')} is deprecated.`);
  }
  if (
    profile.platform === Platform.IOS &&
    [ResourceClass.LARGE, ResourceClass.M1_LARGE].includes(resourceClass)
  ) {
    Log.warn(
      `Large resource classes are not available for iOS builds yet. Your build will use the medium resource class.`
    );
  }

  return profile.platform === Platform.ANDROID
    ? androidResourceClassToBuildResourceClassMapping[
        resourceClass as Exclude<
          ResourceClass,
          | ResourceClass.M1_EXPERIMENTAL
          | ResourceClass.M1_MEDIUM
          | ResourceClass.M1_LARGE
          | ResourceClass.INTEL_MEDIUM
        >
      ]
    : iosResourceClassToBuildResourceClassMapping[resourceClass];
}
