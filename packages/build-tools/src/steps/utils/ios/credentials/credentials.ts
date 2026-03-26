import { Ios } from '@expo/eas-build-job';
import Joi from 'joi';

export const TargetCredentialsSchema = Joi.object<Ios.TargetCredentials>().keys({
  provisioningProfileBase64: Joi.string().required(),
  distributionCertificate: Joi.object({
    dataBase64: Joi.string().required(),
    password: Joi.string().allow('').required(),
  }).required(),
});

export const IosBuildCredentialsSchema = Joi.object<Ios.BuildCredentials>().pattern(
  Joi.string().required(),
  TargetCredentialsSchema
);
