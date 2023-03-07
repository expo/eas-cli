import { Platform } from '@expo/eas-build-job';
import { BuildProfile, ResourceClass } from '@expo/eas-json';
import chalk from 'chalk';

import { BuildResourceClass } from '../../graphql/generated';
import Log, { link } from '../../log';

type AndroidResourceClass = Exclude<
  ResourceClass,
  | ResourceClass.M1_EXPERIMENTAL
  | ResourceClass.M1_MEDIUM
  | ResourceClass.M1_LARGE
  | ResourceClass.INTEL_MEDIUM
  | ResourceClass.M_MEDIUM
  | ResourceClass.M_LARGE
>;

const iosResourceClassToBuildResourceClassMapping: Record<ResourceClass, BuildResourceClass> = {
  [ResourceClass.DEFAULT]: BuildResourceClass.IosDefault,
  [ResourceClass.LARGE]: BuildResourceClass.IosLarge,
  [ResourceClass.M1_EXPERIMENTAL]: BuildResourceClass.IosMMedium,
  [ResourceClass.M1_MEDIUM]: BuildResourceClass.IosMMedium,
  [ResourceClass.M1_LARGE]: BuildResourceClass.IosMLarge,
  [ResourceClass.INTEL_MEDIUM]: BuildResourceClass.IosIntelMedium,
  [ResourceClass.MEDIUM]: BuildResourceClass.IosMedium,
  [ResourceClass.M_MEDIUM]: BuildResourceClass.IosMMedium,
  [ResourceClass.M_LARGE]: BuildResourceClass.IosMLarge,
};

const androidResourceClassToBuildResourceClassMapping: Record<
  AndroidResourceClass,
  BuildResourceClass
> = {
  [ResourceClass.DEFAULT]: BuildResourceClass.AndroidDefault,
  [ResourceClass.LARGE]: BuildResourceClass.AndroidLarge,
  [ResourceClass.MEDIUM]: BuildResourceClass.AndroidMedium,
};

export async function resolveBuildResourceClassAsync<T extends Platform>(
  profile: BuildProfile<T>,
  platform: Platform,
  resourceClassFlag?: ResourceClass
): Promise<BuildResourceClass> {
  const profileResourceClass = profile.resourceClass;

  if (profileResourceClass && resourceClassFlag && resourceClassFlag !== profileResourceClass) {
    Log.warn(
      `Build profile specifies the "${profileResourceClass}" resource class but you passed "${resourceClassFlag}" to --resource-class.\nUsing "${resourceClassFlag}" as the override.`
    );
  }

  const selectedResourceClass = resourceClassFlag ?? profileResourceClass;

  return platform === Platform.IOS
    ? await resolveIosResourceClassAsync(resourceClassFlag, profileResourceClass)
    : resolveAndroidResourceClass(selectedResourceClass);
}

function resolveAndroidResourceClass(selectedResourceClass?: ResourceClass): BuildResourceClass {
  if (
    selectedResourceClass &&
    [
      ResourceClass.M1_EXPERIMENTAL,
      ResourceClass.M1_MEDIUM,
      ResourceClass.M1_LARGE,
      ResourceClass.INTEL_MEDIUM,
    ].includes(selectedResourceClass)
  ) {
    throw new Error(`Resource class ${selectedResourceClass} is only available for iOS builds`);
  }

  const resourceClass = selectedResourceClass ?? ResourceClass.DEFAULT;

  return androidResourceClassToBuildResourceClassMapping[resourceClass as AndroidResourceClass];
}

async function resolveIosResourceClassAsync(
  resourceClassFlag?: ResourceClass,
  profileResourceClass?: ResourceClass
): Promise<BuildResourceClass> {
  const resourceClass = resourceClassFlag ?? profileResourceClass ?? ResourceClass.DEFAULT;

  if (resourceClassFlag === ResourceClass.LARGE) {
    throw new Error(
      `Experimental "large" resource class for Intel iOS workers is no longer available. Remove the specified resource class to use the default, or learn more about all available resource classes: ${link(
        'https://docs.expo.dev/build-reference/eas-json/'
      )}`
    );
  }

  if ([ResourceClass.M1_EXPERIMENTAL, ResourceClass.M1_MEDIUM].includes(resourceClass)) {
    Log.warn(
      `Resource class ${chalk.bold(resourceClass)} is deprecated. Use ${chalk.bold(
        'm-medium'
      )} instead.`
    );
  }

  if (resourceClass === ResourceClass.M1_LARGE) {
    Log.warn(
      `Resource class ${chalk.bold('m1-large')} is deprecated. Use ${chalk.bold(
        'm-large'
      )} instead.`
    );
  }

  return iosResourceClassToBuildResourceClassMapping[resourceClass];
}
