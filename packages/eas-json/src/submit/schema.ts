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
    .regex(/^[\dA-Z]+$/)
    .message(
      'Invalid Apple App Store Connect API Key ID ("ascApiKeyId") was specified. It should consist of uppercase letters or digits. Example: "AB32CZE81F". Learn more: https://expo.fyi/creating-asc-api-key.'
    )
    .max(30), // I didn't find any docs about it, but all of the ones I've seen are 10 characters long so 30 characters limit should be enough
  ascApiKeyIssuerId: Joi.string()
    .uuid() // All of the issuer IDs I've seen are UUIDs, but again, I didn't find any docs about it
    .message(
      'Invalid Apple App Store Connect API Key Issuer ID ("ascApiKeyIssuerId") was specified. It should be a valid UUID. Example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx". Learn more: https://expo.fyi/creating-asc-api-key.'
    ),
  appleId: Joi.string()
    .email()
    .message(
      'Invalid Apple ID was specified. It should be a valid email address. Example: "name@example.com".'
    ),
  ascAppId: Joi.string()
    .regex(/^\d+$/)
    .message(
      'Invalid Apple App Store Connect App ID ("ascAppId") was specified. It should consist only of digits. Example: "1234567891". Learn more: https://expo.fyi/asc-app-id.'
    )
    .max(30), // I didn't find any docs about it, but the longest app ID I've seen is 10 digits long so 30 characters limit should be enough
  appleTeamId: Joi.string()
    .regex(/^[\dA-Z]{10}$/) // Apple says that it always has to be 10 characters long https://developer.apple.com/help/account/manage-your-team/locate-your-team-id/
    .message(
      'Invalid Apple Team ID was specified. It should consist of 10 uppercase letters or digits. Example: "AB32CZE81F".'
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
