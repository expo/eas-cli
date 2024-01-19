import Joi from 'joi';

import { Keystore } from '../android/credentials';

export interface CredentialsJsonIosTargetCredentials {
  provisioningProfilePath: string;
  distributionCertificate: {
    path: string;
    password: string;
  };
}

export interface AndroidCredentials {
  keystore: Keystore;
}

const CredentialsJsonIosTargetCredentialsSchema = Joi.object<CredentialsJsonIosTargetCredentials>({
  provisioningProfilePath: Joi.string().required(),
  distributionCertificate: Joi.object({
    path: Joi.string().required(),
    password: Joi.string().allow('').required(),
  }).required(),
});

export type CredentialsJson = {
  android?: {
    keystore: {
      keystorePath: string;
      keystorePassword: string;
      keyAlias: string;
      keyPassword?: string;
    };
  };
  ios?: CredentialsJsonIosTargetCredentials | Record<string, CredentialsJsonIosTargetCredentials>;
};

export const CredentialsJsonSchema = Joi.object<CredentialsJson>({
  android: Joi.object({
    keystore: Joi.object({
      keystorePath: Joi.string().required(),
      keystorePassword: Joi.string().allow('').required(),
      keyAlias: Joi.string().required(),
      keyPassword: Joi.string().allow(''),
    }).required(),
  }),
  ios: [
    CredentialsJsonIosTargetCredentialsSchema,
    Joi.object().pattern(
      Joi.string().required(),
      CredentialsJsonIosTargetCredentialsSchema.required()
    ),
  ],
});
