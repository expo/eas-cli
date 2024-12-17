import Joi from 'joi';
import semver from 'semver';

import { ResourceClass } from './types';

const AllowedCommonResourceClasses: ResourceClass[] = [
  ResourceClass.DEFAULT,
  ResourceClass.MEDIUM,
  ResourceClass.LARGE,
];

const AllowedAndroidResourceClasses: ResourceClass[] = AllowedCommonResourceClasses;

const AllowedIosResourceClasses: ResourceClass[] = [
  ...AllowedCommonResourceClasses,
  ResourceClass.M1_MEDIUM,
  ResourceClass.M_MEDIUM,
  ResourceClass.M_LARGE,
];

const CacheSchema = Joi.object({
  disabled: Joi.boolean(),
  key: Joi.string().max(128),
  cacheDefaultPaths: Joi.boolean(),
  customPaths: Joi.array().items(Joi.string()),
  paths: Joi.array().items(Joi.string()),
})
  .rename('customPaths', 'paths')
  .messages({
    'object.rename.override':
      'Cannot provide both "cache.customPaths" and "cache.paths" - use "cache.paths"',
  });

const CommonBuildProfileSchema = Joi.object({
  // builder
  resourceClass: Joi.string().valid(...AllowedCommonResourceClasses),

  // build environment
  env: Joi.object().pattern(Joi.string(), Joi.string().empty(null)),
  node: Joi.string().empty(null).custom(semverCheck),
  pnpm: Joi.string().empty(null).custom(semverCheck),
  bun: Joi.string().empty(null).custom(semverCheck),
  yarn: Joi.string().empty(null).custom(semverCheck),
  expoCli: Joi.string().empty(null).custom(semverCheck),

  // credentials
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  distribution: Joi.string().valid('store', 'internal').default('store'),

  // updates
  releaseChannel: Joi.string().regex(/^[a-z\d][a-z\d._-]*$/),
  channel: Joi.string().regex(/^[a-z\d][a-z\d._-]*$/),

  // build configuration
  developmentClient: Joi.boolean(),
  prebuildCommand: Joi.string(),

  // versions
  autoIncrement: Joi.alternatives().try(Joi.boolean()),

  // artifacts
  buildArtifactPaths: Joi.array().items(Joi.string()),

  // cache
  cache: CacheSchema,

  // custom build configuration
  config: Joi.string(),

  // credentials
  withoutCredentials: Joi.boolean(),

  environment: Joi.string().valid('preview', 'production', 'development'),
});

const PlatformBuildProfileSchema = CommonBuildProfileSchema.concat(
  Joi.object({
    // build environment
    image: Joi.string(),

    // artifacts
    artifactPath: Joi.string(),
    applicationArchivePath: Joi.string(),
  }).oxor('artifactPath', 'applicationArchivePath')
);

const AndroidBuildProfileSchema = PlatformBuildProfileSchema.concat(
  Joi.object({
    // builder
    resourceClass: Joi.string().valid(...AllowedAndroidResourceClasses),

    // build environment
    ndk: Joi.string().empty(null).custom(semverCheck),

    // build configuration
    gradleCommand: Joi.string(),
    buildType: Joi.string().valid('apk', 'app-bundle'),

    // versions
    autoIncrement: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('version', 'versionCode')
    ),

    keystoreName: Joi.when('credentialsSource', {
      is: 'remote',
      then: Joi.string(),
      otherwise: Joi.forbidden().messages({
        'any.unknown': 'keystoreName is not allowed when credentialsSource is not remote',
      }),
    }),
  })
);

const IosBuildProfileSchema = PlatformBuildProfileSchema.concat(
  Joi.object({
    // builder
    resourceClass: Joi.string().valid(...AllowedIosResourceClasses),

    // build environment
    bundler: Joi.string().empty(null).custom(semverCheck),
    fastlane: Joi.string().empty(null).custom(semverCheck),
    cocoapods: Joi.string().empty(null).custom(semverCheck),

    // credentials
    enterpriseProvisioning: Joi.string().valid('adhoc', 'universal'),

    // build configuration
    simulator: Joi.boolean(),
    scheme: Joi.string(),
    buildConfiguration: Joi.string(),

    // versions
    autoIncrement: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('version', 'buildNumber')
    ),
  })
);

export const BuildProfileSchema = CommonBuildProfileSchema.concat(
  Joi.object({
    extends: Joi.string(),
    android: AndroidBuildProfileSchema,
    ios: IosBuildProfileSchema,
  })
);

function semverCheck(value: any): any {
  if (semver.valid(value)) {
    return value;
  } else {
    throw new Error(`${value} is not a valid version`);
  }
}
