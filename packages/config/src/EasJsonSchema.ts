import Joi from '@hapi/joi';

const AndroidGenericSchema = Joi.object({
  workflow: Joi.string().valid('generic').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  gradleCommand: Joi.string(),
  releaseChannel: Joi.string(),
  artifactPath: Joi.string(),
  withoutCredentials: Joi.boolean(),
});

const AndroidManagedSchema = Joi.object({
  workflow: Joi.string().valid('managed').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  buildType: Joi.string().valid('apk', 'app-bundle').default('app-bundle'),
});

const iOSGenericSchema = Joi.object({
  workflow: Joi.string().valid('generic').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  scheme: Joi.string(),
  releaseChannel: Joi.string(),
  artifactPath: Joi.string(),
});

const iOSManagedSchema = Joi.object({
  workflow: Joi.string().valid('managed').required(),
  credentialsSource: Joi.string().valid('local', 'remote', 'auto').default('auto'),
  buildType: Joi.string().valid('archive', 'simulator'),
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
