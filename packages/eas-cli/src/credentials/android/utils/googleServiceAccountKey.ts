import JsonFile from '@expo/json-file';
import Joi from 'joi';

import Log, { learnMore } from '../../../log';
import { GoogleServiceAccountKey } from '../credentials';

export const MinimalGoogleServiceAccountKeySchema = Joi.object({
  private_key: Joi.string().required(),
});

export function readAndValidateServiceAccountKey(keyJsonPath: string): GoogleServiceAccountKey {
  try {
    const jsonKeyObject = JsonFile.read(keyJsonPath);
    const { error, value } = MinimalGoogleServiceAccountKeySchema.validate(jsonKeyObject, {
      abortEarly: false,
      allowUnknown: true,
    });
    if (error) {
      const maybeGoogleServicesJson = keyJsonPath.includes('google-services');
      if (maybeGoogleServicesJson) {
        Log.error(
          `Oops! Looks like you uploaded a google-services.json instead of your service account key. ${learnMore(
            'https://expo.fyi/creating-google-service-account'
          )}`
        );
      }
      throw new Error(`Google Service Account JSON Key is not valid [${error.toString()}].`);
    }
    return value as unknown as GoogleServiceAccountKey;
  } catch (err: any) {
    if (err.code === 'EJSONPARSE') {
      err.message = `Found invalid JSON in Google Service Account JSON Key. ${err.message}`;
    }
    throw err;
  }
}
