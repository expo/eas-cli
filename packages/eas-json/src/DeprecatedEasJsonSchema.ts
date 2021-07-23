import { Android, Ios } from '@expo/eas-build-job';
import Joi, { CustomHelpers } from '@hapi/joi';

const semverSchemaCheck = (value: any, helpers: CustomHelpers) => {
  if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) {
    return value;
  } else {
    throw new Error(`${value} is not a valid version`);
  }
};

const AndroidBuilderEnvironmentSchema = Joi.object({
  image: Joi.string()
    .valid(...Android.builderBaseImages)
    .default('default'),
  node: Joi.string().empty(null).custom(semverSchemaCheck),
  yarn: Joi.string().empty(null).custom(semverSchemaCheck),
  ndk: Joi.string().empty(null).custom(semverSchemaCheck),
  expoCli: Joi.string().empty(null).custom(semverSchemaCheck),
  env: Joi.object().pattern(Joi.string(), Joi.string().empty(null)).default({}),
});

const IosBuilderEnvironmentSchema = Joi.object({
  image: Joi.string().valid(...Ios.builderBaseImages),
  node: Joi.string().empty(null).custom(semverSchemaCheck),
  yarn: Joi.string().empty(null).custom(semverSchemaCheck),
  bundler: Joi.string().empty(null).custom(semverSchemaCheck),
  fastlane: Joi.string().empty(null).custom(semverSchemaCheck),
  cocoapods: Joi.string().empty(null).custom(semverSchemaCheck),
  expoCli: Joi.string().empty(null).custom(semverSchemaCheck),
  env: Joi.object().pattern(Joi.string(), Joi.string().empty(null)).default({}),
});

const CacheSchema = Joi.object({
  disabled: Joi.boolean().default(false),
  key: Joi.string().max(128),
  cacheDefaultPaths: Joi.boolean().default(true),
  customPaths: Joi.array().items(Joi.string()).default([]),
});

const AndroidSchema = Joi.object({
  workflow: Joi.string(),
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  releaseChannel: Joi.string(),
  channel: Joi.string(),
  distribution: Joi.string().valid('store', 'internal').default('store'),
  cache: CacheSchema.default(),
  withoutCredentials: Joi.boolean().default(false),

  artifactPath: Joi.string(),
  gradleCommand: Joi.string(),

  buildType: Joi.alternatives().conditional('distribution', {
    is: 'internal',
    then: Joi.string().valid('apk', 'development-client'),
    otherwise: Joi.string().valid('apk', 'app-bundle', 'development-client'),
  }),
}).concat(AndroidBuilderEnvironmentSchema);

const IosSchema = Joi.object({
  workflow: Joi.string(),
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  releaseChannel: Joi.string(),
  channel: Joi.string(),
  distribution: Joi.string().valid('store', 'internal', 'simulator').default('store'),
  enterpriseProvisioning: Joi.string().valid('adhoc', 'universal'),
  autoIncrement: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('version', 'buildNumber'))
    .default(false),
  cache: CacheSchema.default(),

  artifactPath: Joi.string(),
  scheme: Joi.string(),
  schemeBuildConfiguration: Joi.string(),

  buildType: Joi.string().valid('release', 'development-client'),
}).concat(IosBuilderEnvironmentSchema);

export const schemaBuildProfileMap: Record<string, Joi.Schema> = {
  android: AndroidSchema,
  ios: IosSchema,
};

export const EasJsonSchema = Joi.object({
  builds: Joi.object({
    android: Joi.object().pattern(
      Joi.string(),
      Joi.object({}).unknown(true) // profile is validated further only if build is for that platform
    ),
    ios: Joi.object().pattern(
      Joi.string(),
      Joi.object({}).unknown(true) // profile is validated further only if build is for that platform
    ),
  }),
});
