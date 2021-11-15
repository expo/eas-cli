import { Android, Ios } from '@expo/eas-build-job';
import Joi from 'joi';

import { AndroidReleaseStatus, AndroidReleaseTrack } from './EasSubmit.types';

const semverSchemaCheck = (value: any): any => {
  if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) {
    return value;
  } else {
    throw new Error(`${value} is not a valid version`);
  }
};

const CacheSchema = Joi.object({
  disabled: Joi.boolean(),
  key: Joi.string().max(128),
  cacheDefaultPaths: Joi.boolean(),
  customPaths: Joi.array().items(Joi.string()),
});

const CommonBuildProfileSchema = Joi.object({
  credentialsSource: Joi.string().valid('local', 'remote'),
  distribution: Joi.string().valid('store', 'internal'),
  cache: CacheSchema,
  releaseChannel: Joi.string().regex(/^[a-z\d][a-z\d._-]*$/),
  channel: Joi.string().regex(/^[a-z\d][a-z\d._-]*$/),
  developmentClient: Joi.boolean(),

  node: Joi.string().empty(null).custom(semverSchemaCheck),
  yarn: Joi.string().empty(null).custom(semverSchemaCheck),
  expoCli: Joi.string().empty(null).custom(semverSchemaCheck),
  env: Joi.object().pattern(Joi.string(), Joi.string().empty(null)),
});

const AndroidBuildProfileSchema = CommonBuildProfileSchema.concat(
  Joi.object({
    withoutCredentials: Joi.boolean(),

    image: Joi.string().valid(...Android.builderBaseImages),
    ndk: Joi.string().empty(null).custom(semverSchemaCheck),
    autoIncrement: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('version', 'versionCode')
    ),

    artifactPath: Joi.string(),
    gradleCommand: Joi.string(),

    buildType: Joi.string().valid('apk', 'app-bundle'),
  })
);

const IosBuildProfileSchema = CommonBuildProfileSchema.concat(
  Joi.object({
    enterpriseProvisioning: Joi.string().valid('adhoc', 'universal'),
    autoIncrement: Joi.alternatives().try(
      Joi.boolean(),
      Joi.string().valid('version', 'buildNumber')
    ),
    simulator: Joi.boolean(),

    image: Joi.string().valid(...Ios.builderBaseImages),
    bundler: Joi.string().empty(null).custom(semverSchemaCheck),
    fastlane: Joi.string().empty(null).custom(semverSchemaCheck),
    cocoapods: Joi.string().empty(null).custom(semverSchemaCheck),

    artifactPath: Joi.string(),
    scheme: Joi.string(),
    buildConfiguration: Joi.string(),
  })
);

const EasJsonBuildProfileSchema = CommonBuildProfileSchema.concat(
  Joi.object({
    extends: Joi.string(),
    android: AndroidBuildProfileSchema,
    ios: IosBuildProfileSchema,
  })
);

export const AndroidSubmitProfileSchema = Joi.object({
  serviceAccountKeyPath: Joi.string(),
  track: Joi.string()
    .valid(...Object.values(AndroidReleaseTrack))
    .default(AndroidReleaseTrack.internal),
  releaseStatus: Joi.string()
    .valid(...Object.values(AndroidReleaseStatus))
    .default(AndroidReleaseStatus.completed),
  changesNotSentForReview: Joi.boolean().default(false),
});

export const IosSubmitProfileSchema = Joi.object({
  ascApiKeyPath: Joi.string(),
  ascApiKeyId: Joi.string(),
  ascApiKeyIssuerId: Joi.string(),
  appleId: Joi.string(),
  ascAppId: Joi.string(),
  appleTeamId: Joi.string(),
  sku: Joi.string(),
  language: Joi.string().default('en-US'),
  companyName: Joi.string(),
  appName: Joi.string(),
});

const EasJsonSubmitConfigurationSchema = Joi.object({
  android: AndroidSubmitProfileSchema,
  ios: IosSubmitProfileSchema,
});

export const CliConfigSchema = Joi.object({
  version: Joi.string(),
  requireCommit: Joi.boolean(),
});

export const MinimalEasJsonSchema = Joi.object({
  cli: Joi.object(),
  build: Joi.object().pattern(Joi.string(), Joi.object()),
  submit: Joi.object().pattern(Joi.string(), Joi.object()),
});

export const EasJsonSchema = Joi.object({
  cli: CliConfigSchema,
  build: Joi.object().pattern(Joi.string(), EasJsonBuildProfileSchema),
  submit: Joi.object().pattern(Joi.string(), EasJsonSubmitConfigurationSchema),
});
