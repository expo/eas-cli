import { Platform } from '@expo/eas-build-job';
import { BuildProfile, ResourceClass } from '@expo/eas-json';
import chalk from 'chalk';

import { BuildResourceClass } from '../../graphql/generated';
import Log, { link } from '../../log';

type AndroidResourceClass = Exclude<
  ResourceClass,
  ResourceClass.M1_MEDIUM | ResourceClass.M_MEDIUM | ResourceClass.M_LARGE
>;

const iosResourceClassToBuildResourceClassMapping: Record<ResourceClass, BuildResourceClass> = {
  [ResourceClass.DEFAULT]: BuildResourceClass.IosDefault,
  [ResourceClass.LARGE]: BuildResourceClass.IosLarge,
  [ResourceClass.M1_MEDIUM]: BuildResourceClass.IosMMedium,
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

export function resolveBuildResourceClass<T extends Platform>(
  profile: BuildProfile<T>,
  platform: Platform,
  resourceClassFlag?: ResourceClass
): BuildResourceClass {
  const profileResourceClass = profile.resourceClass;

  if (profileResourceClass && resourceClassFlag && resourceClassFlag !== profileResourceClass) {
    Log.warn(
      `Build profile specifies the "${profileResourceClass}" resource class but you passed "${resourceClassFlag}" to --resource-class.\nUsing "${resourceClassFlag}" as the override.`
    );
  }

  const selectedResourceClass = resourceClassFlag ?? profileResourceClass;

  return platform === Platform.IOS
    ? resolveIosResourceClass(resourceClassFlag, profileResourceClass)
    : resolveAndroidResourceClass(selectedResourceClass);
}

function resolveAndroidResourceClass(selectedResourceClass?: ResourceClass): BuildResourceClass {
  if (selectedResourceClass && ResourceClass.M1_MEDIUM === selectedResourceClass) {
    throw new Error(`Resource class ${selectedResourceClass} is only available for iOS builds`);
  }

  const resourceClass = selectedResourceClass ?? ResourceClass.DEFAULT;

  return androidResourceClassToBuildResourceClassMapping[resourceClass as AndroidResourceClass];
}

function resolveIosResourceClass(
  resourceClassFlag?: ResourceClass,
  profileResourceClass?: ResourceClass
): BuildResourceClass {
  const resourceClass = resourceClassFlag ?? profileResourceClass ?? ResourceClass.DEFAULT;

  if (resourceClassFlag === ResourceClass.LARGE) {
    throw new Error(
      `Experimental "large" resource class for Intel iOS workers is no longer available. Remove the specified resource class to use the default, or learn more about all available resource classes: ${link(
        'https://docs.expo.dev/build-reference/eas-json/'
      )}`
    );
  }

  if (ResourceClass.M1_MEDIUM === resourceClass) {
    Log.warn(
      `Resource class ${chalk.bold(resourceClass)} is deprecated. Use ${chalk.bold(
        'm-medium'
      )} instead.`
    );
  }

  if (ResourceClass.M_LARGE === resourceClass) {
    Log.warn(
      `Resource class ${chalk.bold(resourceClass)} is deprecated. Use ${chalk.bold(
        'large'
      )} instead.`
    );
  }

  return iosResourceClassToBuildResourceClassMapping[resourceClass];
}
