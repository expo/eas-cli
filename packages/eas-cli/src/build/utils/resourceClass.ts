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

async function resolveIosDefaultRequestedResourceClassAsync(
  getDynamicProjectConfigAsync: DynamicConfigContextFn,
  projectDir: string,
  buildProfile: ProfileData<'build'>
): Promise<ResourceClass> {
  const { exp } = await getDynamicProjectConfigAsync({ env: buildProfile.profile.env });
  const { sdkVersion } = exp;
  const reactNativeVersion = await getReactNativeVersionAsync(projectDir);
  if (
    (sdkVersion && semver.satisfies(sdkVersion, '>=48')) ||
    (reactNativeVersion && semver.satisfies(reactNativeVersion, '>=0.71.0'))
  ) {
    return ResourceClass.M1_MEDIUM;
  } else {
    return ResourceClass.DEFAULT;
  }
}

function resolveAndroidResourceClass(
  profileResourceClass?: ResourceClass,
  resourceClassFlag?: ResourceClass
): BuildResourceClass {
  if (
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

  const resourceClass = resourceClassFlag ?? profileResourceClass ?? ResourceClass.DEFAULT;

  return androidResourceClassToBuildResourceClassMapping[
    resourceClass as Exclude<
      ResourceClass,
      | ResourceClass.M1_EXPERIMENTAL
      | ResourceClass.M1_MEDIUM
      | ResourceClass.M1_LARGE
      | ResourceClass.INTEL_MEDIUM
    >
  ];
}

async function resolveIosResourceClassAsync(
  buildProfile: ProfileData<'build'>,
  getDynamicProjectConfigAsync: DynamicConfigContextFn,
  projectDir: string,
  profileResourceClass?: ResourceClass,
  resourceClassFlag?: ResourceClass
): Promise<BuildResourceClass> {
  const resourceClass =
    resourceClassFlag ??
    profileResourceClass ??
    (await resolveIosDefaultRequestedResourceClassAsync(
      getDynamicProjectConfigAsync,
      projectDir,
      buildProfile
    ));

  if (resourceClass === ResourceClass.M1_EXPERIMENTAL) {
    Log.warn(`Resource class ${chalk.bold('m1-experimental')} is deprecated.`);
  }

  if ([ResourceClass.LARGE, ResourceClass.M1_LARGE].includes(resourceClass)) {
    Log.warn(
      `Large resource classes are not available for iOS builds yet. Your build will use the medium resource class.`
    );
  }

  return iosResourceClassToBuildResourceClassMapping[resourceClass];
}

export async function resolveBuildResourceClassAsync(
  profile: ProfileData<'build'>,
  projectDir: string,
  getDynamicProjectConfigAsync: DynamicConfigContextFn,
  resourceClassFlag?: ResourceClass
): Promise<BuildResourceClass> {
  const profileResourceClass = profile.profile.resourceClass;
  if (profileResourceClass && resourceClassFlag && resourceClassFlag !== profileResourceClass) {
    Log.warn(
      `Build profile specifies the "${profileResourceClass}" resource class but you passed "${resourceClassFlag}" to --resource-class.\nUsing the  "${resourceClassFlag}" as the override.`
    );
  }

  return profile.platform === Platform.IOS
    ? await resolveIosResourceClassAsync(
        profile,
        getDynamicProjectConfigAsync,
        projectDir,
        profileResourceClass,
        resourceClassFlag
      )
    : resolveAndroidResourceClass(profileResourceClass, resourceClassFlag);
}
