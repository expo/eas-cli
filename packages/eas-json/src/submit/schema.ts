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
  rollout: Joi.number().min(0).max(1).when('releaseStatus', {
    is: AndroidReleaseStatus.inProgress,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});

// it is less strict submission schema allowing for magic syntax like "$ASC_API_KEY_PATH"
// to read value from environment variable later on
export const UnresolvedIosSubmitProfileSchema = Joi.object({
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
  metadataPath: Joi.string(),
});

// more strict version after resolving all of the values
export const ResolvedIosSubmitProfileSchema = Joi.object({
  ascApiKeyPath: Joi.string(),
  ascApiKeyId: Joi.string()
    .regex(/^[\dA-Z]{10}$/)
    .message(
      'Invalid Apple App Store Connect API Key ID ("ascApiKeyId") was specified. It should consist of 10 upper case letters or digits. Example: "AB32CDE81F". Learn more: https://expo.fyi/creating-asc-api-key.'
    ),
  ascApiKeyIssuerId: Joi.string()
    .uuid()
    .message(
      'Invalid Apple App Store Connect API Key Issuer ID ("ascApiKeyIssuerId") was specified. It should be a valid UUID. Example: "b4d78f58-48c6-4f2c-96cb-94d8cd76970a". Learn more: https://expo.fyi/creating-asc-api-key.'
    ),
  appleId: Joi.string()
    .email()
    .message(
      'Invalid Apple ID was specified. It should be a valid email address. Example: "name@domain.com".'
    ),
  ascAppId: Joi.string()
    .regex(/^\d{10}$/)
    .message(
      'Invalid Apple App Store Connect App ID ("ascAppId") was specified. It should consist of 10 digits. Example: "1234567891". Learn more: https://expo.fyi/asc-app-id.md.'
    ),
  appleTeamId: Joi.string()
    .regex(/^[\dA-Z]{10}$/)
    .message(
      'Invalid Apple Team ID was specified. It should consist of 10 letters or digits. Example: "AB32CDE81F".'
    ),
  sku: Joi.string(),
  language: Joi.string().default('en-US'),
  companyName: Joi.string(),
  appName: Joi.string(),
  bundleIdentifier: Joi.string(),
  metadataPath: Joi.string(),
});

export const UnresolvedSubmitProfileSchema = Joi.object({
  extends: Joi.string(),
  android: AndroidSubmitProfileSchema,
  ios: UnresolvedIosSubmitProfileSchema,
});
