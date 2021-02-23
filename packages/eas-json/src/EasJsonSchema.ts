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
  node: Joi.string().custom(semverSchemaCheck),
  yarn: Joi.string().custom(semverSchemaCheck),
  ndk: Joi.string(),
  env: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
});

const IosBuilderEnvironmentSchema = Joi.object({
  image: Joi.string()
    .valid(...Ios.builderBaseImages)
    .default('default'),
  node: Joi.string().custom(semverSchemaCheck),
  yarn: Joi.string().custom(semverSchemaCheck),
  fastlane: Joi.string().custom(semverSchemaCheck),
  cocoapods: Joi.string().custom(semverSchemaCheck),
  env: Joi.object().pattern(Joi.string(), Joi.string()).default({}),
});

const AndroidGenericSchema = Joi.object({
  workflow: Joi.string().valid('generic').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  gradleCommand: Joi.alternatives().conditional('distribution', {
    is: 'internal',
    then: Joi.string().default(':app:assembleRelease'),
    otherwise: Joi.string(),
  }),
  releaseChannel: Joi.string(),
  artifactPath: Joi.string(),
  withoutCredentials: Joi.boolean(),
  distribution: Joi.string().valid('store', 'internal').default('store'),
}).concat(AndroidBuilderEnvironmentSchema);

const AndroidManagedSchema = Joi.object({
  workflow: Joi.string().valid('managed').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  releaseChannel: Joi.string(),
  buildType: Joi.alternatives().conditional('distribution', {
    is: 'internal',
    then: Joi.string().valid('apk').default('apk'),
    otherwise: Joi.string().valid('apk', 'app-bundle', 'development-client').default('app-bundle'),
  }),
  distribution: Joi.string().valid('store', 'internal').default('store'),
}).concat(AndroidBuilderEnvironmentSchema);

const iOSGenericSchema = Joi.object({
  workflow: Joi.string().valid('generic').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  scheme: Joi.string(),
  schemeBuildConfiguration: Joi.string().valid('Debug', 'Release'),
  releaseChannel: Joi.string(),
  artifactPath: Joi.string(),
  distribution: Joi.string().valid('store', 'internal', 'simulator').default('store'),
  autoIncrement: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('version', 'buildNumber'))
    .default(false),
}).concat(IosBuilderEnvironmentSchema);

const iOSManagedSchema = Joi.object({
  workflow: Joi.string().valid('managed').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  buildType: Joi.string().valid('release', 'development-client'),
  releaseChannel: Joi.string(),
  distribution: Joi.string().valid('store', 'internal', 'simulator').default('store'),
  autoIncrement: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('version', 'buildNumber'))
    .default(false),
}).concat(IosBuilderEnvironmentSchema);

const schemaBuildProfileMap: Record<string, Record<string, Joi.Schema>> = {
  android: {
    generic: AndroidGenericSchema,
    managed: AndroidManagedSchema,
  },
  ios: {
    managed: iOSManagedSchema,
    generic: iOSGenericSchema,
  },
};

const EasJsonSchema = Joi.object({
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
