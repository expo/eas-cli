import Joi from 'joi';
import semver from 'semver';

import { ResourceClass } from './types';

const AllowedCommonResourceClasses: ResourceClass[] = [ResourceClass.DEFAULT, ResourceClass.MEDIUM];

const AllowedAndroidResourceClasses: ResourceClass[] = [
  ...AllowedCommonResourceClasses,
  ResourceClass.LARGE,
];

const AllowedIosResourceClasses: ResourceClass[] = [
  ...AllowedCommonResourceClasses,
  ResourceClass.M1_MEDIUM,
  ResourceClass.INTEL_MEDIUM,
];

const CacheSchema = Joi.object({
  disabled: Joi.boolean(),
  key: Joi.string().max(128),
  cacheDefaultPaths: Joi.boolean(),
  customPaths: Joi.array().items(Joi.string()),
});

const CommonBuildProfileSchema = Joi.object({
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  distribution: Joi.string().valid('store', 'internal').default('store'),
  cache: CacheSchema,
  releaseChannel: Joi.string().regex(/^[a-z\d][a-z\d._-]*$/),
  channel: Joi.string().regex(/^[a-z\d][a-z\d._-]*$/),
  developmentClient: Joi.boolean(),
  prebuildCommand: Joi.string(),
  buildArtifactPaths: Joi.array().items(Joi.string()),

  node: Joi.string().empty(null).custom(semverCheck),
  yarn: Joi.string().empty(null).custom(semverCheck),
  expoCli: Joi.string().empty(null).custom(semverCheck),
  env: Joi.object().pattern(Joi.string(), Joi.string().empty(null)),
  autoIncrement: Joi.alternatives().try(Joi.boolean()),
  resourceClass: Joi.string().valid(...AllowedCommonResourceClasses),

  // TODO: add validation
  config: Joi.string(),
});

const AndroidBuildProfileSchema = CommonBuildProfileSchema.concat(
  Joi.object({
    credentialsSource: Joi.string().valid('local', 'remote'),
    distribution: Joi.string().valid('store', 'internal'),
    withoutCredentials: Joi.boolean(),

    image: Joi.string(),
    ndk: Joi.string().empty(null).custom(semverCheck),
    autoIncrement: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('version', 'versionCode')
    ),
    resourceClass: Joi.string().valid(...AllowedAndroidResourceClasses),

    artifactPath: Joi.string(),
    applicationArchivePath: Joi.string(),
    buildArtifactPaths: Joi.array().items(Joi.string()),
    gradleCommand: Joi.string(),

    buildType: Joi.string().valid('apk', 'app-bundle'),
  }).oxor('artifactPath', 'applicationArchivePath')
);

const IosBuildProfileSchema = CommonBuildProfileSchema.concat(
  Joi.object({
    credentialsSource: Joi.string().valid('local', 'remote'),
    distribution: Joi.string().valid('store', 'internal'),
    enterpriseProvisioning: Joi.string().valid('adhoc', 'universal'),
    autoIncrement: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('version', 'buildNumber')
    ),
    simulator: Joi.boolean(),
    resourceClass: Joi.string().valid(...AllowedIosResourceClasses),

    image: Joi.string(),
    bundler: Joi.string().empty(null).custom(semverCheck),
    fastlane: Joi.string().empty(null).custom(semverCheck),
    cocoapods: Joi.string().empty(null).custom(semverCheck),

    artifactPath: Joi.string(),
    applicationArchivePath: Joi.string(),
    buildArtifactPaths: Joi.array().items(Joi.string()),
    scheme: Joi.string(),
    buildConfiguration: Joi.string(),
  }).oxor('artifactPath', 'applicationArchivePath')
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
