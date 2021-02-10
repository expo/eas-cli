import Joi from '@hapi/joi';

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
});

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
});

const iOSGenericSchema = Joi.object({
  workflow: Joi.string().valid('generic').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  scheme: Joi.string(),
  releaseChannel: Joi.string(),
  artifactPath: Joi.string(),
  distribution: Joi.string().valid('store', 'internal').default('store'),
  autoincrement: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('version', 'buildNumber'))
    .default('buildNumber'),
});

const iOSManagedSchema = Joi.object({
  workflow: Joi.string().valid('managed').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  releaseChannel: Joi.string(),
  distribution: Joi.string().valid('store', 'internal').default('store'),
  autoincrement: Joi.alternatives()
    .try(Joi.boolean(), Joi.string().valid('version', 'buildNumber'))
    .default('buildNumber'),
});

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
        workflow: Joi.string().valid('generic', 'managed').required(),
      }).unknown(true) // profile is validated further only if build is for that platform
    ),
    ios: Joi.object().pattern(
      Joi.string(),
      Joi.object({
        workflow: Joi.string().valid('generic', 'managed').required(),
      }).unknown(true) // profile is validated further only if build is for that platform
    ),
  }),
});

export { EasJsonSchema, schemaBuildProfileMap };
