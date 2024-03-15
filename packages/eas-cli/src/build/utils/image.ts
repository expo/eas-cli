import {
  AndroidWorkerImageWithAliases,
  AndroidWorkerImageWithoutAliases,
  IosWorkerImageWithAliases,
  IosWorkerImageWithoutAliases,
  Metadata,
  Platform,
  Workflow,
} from '@expo/eas-build-job';
import semver from 'semver';

import Log, { learnMore } from '../../log';
import { BuildContext } from '../context';

interface ImageMatchRule<T extends Platform> {
  image: T extends Platform.ANDROID
    ? AndroidWorkerImageWithoutAliases
    : IosWorkerImageWithoutAliases;
  reactNativeSemverRange?: string;
  sdkSemverRange?: string;
  workflows?: Workflow[];
}

interface ImageMatchArgs {
  sdkVersion?: string;
  reactNativeVersion?: string;
  workflow: Workflow;
}

type ImageMatchResolveArgs<T extends Platform> = ImageMatchArgs & { platform: T };

export function resolveWorkerImage<TPlatform extends Platform>({
  ctx,
  metadata,
}: {
  ctx: BuildContext<TPlatform>;
  metadata: Metadata;
}): AndroidWorkerImageWithAliases | IosWorkerImageWithAliases {
  if (ctx.platform === Platform.ANDROID) {
    return resolveAndroidWorkerImage({
      ctx: ctx as BuildContext<Platform.ANDROID>,
      metadata,
    });
  } else {
    return resolveIosWorkerImage({ ctx: ctx as BuildContext<Platform.IOS>, metadata });
  }
}

function resolveAndroidWorkerImage({
  ctx,
  metadata,
}: {
  ctx: BuildContext<Platform.ANDROID>;
  metadata: Metadata;
}): AndroidWorkerImageWithAliases {
  return (
    ctx.buildProfile.image ??
    resolveDefaultWorkerImageRule({
      sdkVersion: metadata.sdkVersion,
      workflow: ctx.workflow,
      reactNativeVersion: metadata.reactNativeVersion,
      platform: ctx.platform,
    }).image
  );
}

function resolveIosWorkerImage({
  ctx,
  metadata,
}: {
  ctx: BuildContext<Platform.IOS>;
  metadata: Metadata;
}): IosWorkerImageWithAliases {
  return (
    ctx.buildProfile.image ??
    resolveDefaultWorkerImageRule({
      sdkVersion: metadata.sdkVersion,
      workflow: ctx.workflow,
      reactNativeVersion: metadata.reactNativeVersion,
      platform: ctx.platform,
    }).image
  );
}

function resolveDefaultWorkerImageRule<T extends Platform>({
  sdkVersion,
  reactNativeVersion,
  workflow,
  platform,
}: ImageMatchResolveArgs<T>): ImageMatchRule<T> {
  Log.log();
  Log.log(
    'No image was specified. EAS CLI will resolve the image to be used for this build based on the project configuration, React Native version and Expo SDK version used by the project...'
  );
  logDataUsedForImageResolution({ sdkVersion, reactNativeVersion, workflow });
  const resolveArgs: ImageMatchArgs = {
    sdkVersion,
    reactNativeVersion,
    workflow,
  };
  const rules = (
    platform === Platform.IOS ? iosImageMatchRules : androidImageMatchRules
  ) as ImageMatchRule<T>[];
  for (const rule of rules) {
    if (doesImageRuleMatch(rule, resolveArgs)) {
      Log.log(`✅ Resolved ${rule.image} image as the best match for the given configuration`);
      return rule;
    }
  }
  Log.error(
    `❌ EAS CLI wasn't able to automatically find worker image for the given configuration. Specify the image manually in your eas.json configuration file to fix this problem. ${learnMore(
      platform === Platform.ANDROID
        ? 'https://docs.expo.dev/eas/json/#image'
        : 'https://docs.expo.dev/eas/json/#image-1'
    )}`
  );
  throw new Error('No worker image found for the given configuration');
}

const iosImageMatchRules: ImageMatchRule<Platform.IOS>[] = [
  {
    image: 'macos-monterey-12.4-xcode-13.4',
    sdkSemverRange: '>=45 <47',
    workflows: [Workflow.MANAGED],
  },
  {
    image: 'macos-monterey-12.6-xcode-14.1',
    sdkSemverRange: '>=47 <48',
  },
  {
    image: 'macos-monterey-12.6-xcode-14.2',
    sdkSemverRange: '>=48 <49',
  },
  {
    image: 'macos-ventura-13.4-xcode-14.3.1',
    sdkSemverRange: '>=49 <50',
  },
  {
    image: 'macos-ventura-13.6-xcode-15.2',
    sdkSemverRange: '>=50',
  },
  {
    image: 'macos-monterey-12.6-xcode-14.2',
    reactNativeSemverRange: '>=0.70.0',
  },
];

const androidImageMatchRules: ImageMatchRule<Platform.ANDROID>[] = [
  {
    image: 'ubuntu-20.04-jdk-11-ndk-r19c',
    reactNativeSemverRange: '>=0.68.0',
    sdkSemverRange: '<46',
  },
  {
    image: 'ubuntu-20.04-jdk-8-ndk-r19c',
    reactNativeSemverRange: '<0.68.0',
    sdkSemverRange: '<46',
  },
  {
    image: 'ubuntu-20.04-jdk-11-ndk-r21e',
    reactNativeSemverRange: '>=0.68.0 <0.73.0',
    sdkSemverRange: '>=46 <50',
  },
  {
    image: 'ubuntu-20.04-jdk-8-ndk-r21e',
    reactNativeSemverRange: '<0.68.0',
    sdkSemverRange: '>=46 <50',
  },
  {
    image: 'ubuntu-22.04-jdk-17-ndk-r21e',
    sdkSemverRange: '>=50',
  },
  {
    image: 'ubuntu-22.04-jdk-17-ndk-r21e',
    reactNativeSemverRange: '>=0.73.0',
  },
];

function doesImageRuleMatch<T extends Platform>(
  rule: ImageMatchRule<T>,
  { sdkVersion, reactNativeVersion, workflow }: ImageMatchArgs
): boolean {
  if (rule.reactNativeSemverRange) {
    if (!reactNativeVersion || !semver.satisfies(reactNativeVersion, rule.reactNativeSemverRange)) {
      return false;
    }
  }
  if (rule.sdkSemverRange) {
    if (!sdkVersion || !semver.satisfies(sdkVersion, rule.sdkSemverRange)) {
      return false;
    }
  }
  if (rule.workflows && !rule.workflows?.includes(workflow)) {
    return false;
  }
  return true;
}

function logDataUsedForImageResolution({
  sdkVersion,
  reactNativeVersion,
  workflow,
}: ImageMatchArgs): void {
  Log.log(`\tExpo SDK version: ${sdkVersion ? sdkVersion : 'Expo SDK not detected'}`);
  Log.log(
    `\tReact Native version: ${
      reactNativeVersion ? reactNativeVersion : 'React Native not detected'
    }`
  );
  Log.log(`\tWorkflow: ${workflow}`);
}
