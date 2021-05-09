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
  env: Joi.object().pattern(Joi.string(), Joi.string().empty(null)).default({}),
});

const IosBuilderEnvironmentSchema = Joi.object({
  image: Joi.string()
    .valid(...Ios.builderBaseImages)
    .default('default'),
  node: Joi.string().empty(null).custom(semverSchemaCheck),
  yarn: Joi.string().empty(null).custom(semverSchemaCheck),
  bundler: Joi.string().empty(null).custom(semverSchemaCheck),
  fastlane: Joi.string().empty(null).custom(semverSchemaCheck),
  cocoapods: Joi.string().empty(null).custom(semverSchemaCheck),
  env: Joi.object().pattern(Joi.string(), Joi.string().empty(null)).default({}),
});

const CacheSchema = Joi.object({
  disabled: Joi.boolean().default(false),
  key: Joi.string().max(128),
  cacheDefaultPaths: Joi.boolean().default(true),
  customPaths: Joi.array().items(Joi.string()).default([]),
});

const AndroidGenericSchema = Joi.object({
  workflow: Joi.string().valid('generic').required(),
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  gradleCommand: Joi.alternatives().conditional('distribution', {
    is: 'internal',
    then: Joi.string().default(':app:assembleRelease'),
    otherwise: Joi.string(),
  }),
  releaseChannel: Joi.string(),
  artifactPath: Joi.string(),
  withoutCredentials: Joi.boolean().default(false),
  distribution: Joi.string().valid('store', 'internal').default('store'),
  cache: CacheSchema.default(),
}).concat(AndroidBuilderEnvironmentSchema);

const AndroidManagedSchema = Joi.object({
  workflow: Joi.string().valid('managed').required(),
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  releaseChannel: Joi.string(),
  buildType: Joi.alternatives().conditional('distribution', {
    is: 'internal',
    then: Joi.string().valid('apk').default('apk'),
    otherwise: Joi.string().valid('apk', 'app-bundle', 'development-client').default('app-bundle'),
  }),
  distribution: Joi.string().valid('store', 'internal').default('store'),
  cache: CacheSchema.default(),
}).concat(AndroidBuilderEnvironmentSchema);

const IosGenericSchema = Joi.object({
  workflow: Joi.string().valid('generic').required(),
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  scheme: Joi.string(),
  buildConfiguration: Joi.string(),
  releaseChannel: Joi.string(),
  artifactPath: Joi.string(),
  distribution: Joi.string().valid('store', 'internal', 'simulator').default('store'),
  enterpriseProvisioning: Joi.string().valid('adhoc', 'universal'),
  autoIncrement: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('version', 'buildNumber'))
    .default(false),
  cache: CacheSchema.default(),
}).concat(IosBuilderEnvironmentSchema);

const IosManagedSchema = Joi.object({
  workflow: Joi.string().valid('managed').required(),
  credentialsSource: Joi.string().valid('local', 'remote').default('remote'),
  buildType: Joi.string().valid('release', 'development-client').default('release'),
  releaseChannel: Joi.string(),
  distribution: Joi.string().valid('store', 'internal', 'simulator').default('store'),
  enterpriseProvisioning: Joi.string().valid('adhoc', 'universal'),
  autoIncrement: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('version', 'buildNumber'))
    .default(false),
  cache: CacheSchema.default(),
}).concat(IosBuilderEnvironmentSchema);

const schemaBuildProfileMap: Record<string, Record<string, Joi.Schema>> = {
  android: {
    generic: AndroidGenericSchema,
    managed: AndroidManagedSchema,
  },
  ios: {
    managed: IosManagedSchema,
    generic: IosGenericSchema,
  },
};

const EasJsonSchema = Joi.object({
  experimental: Joi.object({
    disableIosBundleIdentifierValidation: Joi.boolean(),
  }),
  builds: Joi.object({
    android: Joi.object().pattern(
      Joi.string(),
      Joi.object({
        workflow: Joi.string().valid('generic', 'managed'),
      }).unknown(true) // profile is validated further only if build is for that platform
    ),
    ios: Joi.object().pattern(
      Joi.string(),
      Joi.object({
        workflow: Joi.string().valid('generic', 'managed'),
      }).unknown(true) // profile is validated further only if build is for that platform
    ),
  }),
});

export { EasJsonSchema, schemaBuildProfileMap };
