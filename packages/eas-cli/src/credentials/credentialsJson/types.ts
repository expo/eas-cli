import Joi from '@hapi/joi';

import { Keystore } from '../android/credentials';

export interface CredentialsJson {
  android?: CredentialsJsonAndroidCredentials;
  ios?: CredentialsJsonIosTargetCredentials | CredentialsJsonIosCredentials;
}

export interface CredentialsJsonAndroidCredentials {
  keystore: {
    keystorePath: string;
    keystorePassword: string;
    keyAlias: string;
    keyPassword?: string;
  };
}

export interface CredentialsJsonIosTargetCredentials {
  provisioningProfilePath: string;
  distributionCertificate: {
    path: string;
    password: string;
  };
}
export type CredentialsJsonIosCredentials = Record<string, CredentialsJsonIosTargetCredentials>;

export interface AndroidCredentials {
  keystore: Keystore;
}

export interface IosTargetCredentials {
  provisioningProfile: string;
  distributionCertificate: {
    certificateP12: string;
    certificatePassword: string;
  };
}
export type IosCredentials = Record<string, IosTargetCredentials>;

const CredentialsJsonIosTargetCredentialsSchema = Joi.object({
  provisioningProfilePath: Joi.string().required(),
  distributionCertificate: Joi.object({
    path: Joi.string().required(),
    password: Joi.string().allow('').required(),
  }).required(),
});

export const CredentialsJsonSchema = Joi.object({
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
