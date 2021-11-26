import Joi from 'joi';

import { AndroidReleaseStatus, AndroidReleaseTrack } from './types';

export const AndroidSubmitProfileSchema = Joi.object({
  serviceAccountKeyPath: Joi.string(),
  track: Joi.string()
    .valid(...Object.values(AndroidReleaseTrack))
    .default(AndroidReleaseTrack.internal),
  releaseStatus: Joi.string()
    .valid(...Object.values(AndroidReleaseStatus))
    .default(AndroidReleaseStatus.completed),
  changesNotSentForReview: Joi.boolean().default(false),
  applicationId: Joi.string(),
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
  bundleIdentifier: Joi.string(),
});

export const SubmitProfileSchema = Joi.object({
  extends: Joi.string(),
  android: AndroidSubmitProfileSchema,
  ios: IosSubmitProfileSchema,
});
