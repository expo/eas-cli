import JsonFile from '@expo/json-file';
import chalk from 'chalk';
import Joi from 'joi';

import { GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { fromNow } from '../../../utils/date';
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

export async function selectGoogleServiceAccountKeyAsync(
  keys: GoogleServiceAccountKeyFragment[]
): Promise<GoogleServiceAccountKeyFragment> {
  const sortedKeys = sortGoogleServiceAccountKeysByUpdatedAtDesc(keys);
  const { chosenKey } = await promptAsync({
    type: 'select',
    name: 'chosenKey',
    message: 'Select a Google Service Account Key:',
    choices: sortedKeys.map(key => ({
      title: formatGoogleServiceAccountKey(key),
      value: key,
    })),
  });
  return chosenKey;
}

function sortGoogleServiceAccountKeysByUpdatedAtDesc(
  keys: GoogleServiceAccountKeyFragment[]
): GoogleServiceAccountKeyFragment[] {
  return keys.sort(
    (keyA, keyB) => new Date(keyB.updatedAt).getTime() - new Date(keyA.updatedAt).getTime()
  );
}

function formatGoogleServiceAccountKey({
  projectIdentifier,
  privateKeyIdentifier,
  clientEmail,
  clientIdentifier,
  updatedAt,
}: GoogleServiceAccountKeyFragment): string {
  let line = `Client Email: ${clientEmail}, Project Id: ${projectIdentifier}`;
  line += chalk.gray(
    `\n    Client Id: ${clientIdentifier}, Private Key Id: ${privateKeyIdentifier}`
  );
  line += chalk.gray(`\n    Updated: ${fromNow(new Date(updatedAt))} ago,`);
  return line;
}
