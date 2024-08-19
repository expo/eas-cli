import JsonFile from '@expo/json-file';
import chalk from 'chalk';
import glob from 'fast-glob';
import Joi from 'joi';
import path from 'path';

import { GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { fromNow } from '../../../utils/date';
import { GoogleServiceAccountKey } from '../credentials';

export const MinimalGoogleServiceAccountKeySchema = Joi.object({
  type: Joi.string().required(),
  private_key: Joi.string().required(),
  client_email: Joi.string().required(),
});

function fileIsServiceAccountKey(keyJsonPath: string): boolean {
  try {
    readAndValidateServiceAccountKey(keyJsonPath);
    return true;
  } catch {
    return false;
  }
}

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

export async function detectGoogleServiceAccountKeyPathAsync(
  projectDir: string
): Promise<string | null> {
  const foundFilePaths = await glob('**/*.json', {
    cwd: projectDir,
    ignore: ['app.json', 'package*.json', 'tsconfig.json', 'node_modules', 'google-services.json'],
  });

  const googleServiceFiles = foundFilePaths
    .map(file => path.join(projectDir, file))
    .filter(fileIsServiceAccountKey);

  if (googleServiceFiles.length > 1) {
    const selectedPath = await displayPathChooserAsync(googleServiceFiles, projectDir);

    if (selectedPath) {
      return selectedPath;
    }
  } else if (googleServiceFiles.length === 1) {
    const [detectedPath] = googleServiceFiles;

    if (await confirmDetectedPathAsync(detectedPath)) {
      return detectedPath;
    }
  }

  return null;
}

async function displayPathChooserAsync(
  paths: string[],
  projectDir: string
): Promise<string | null> {
  const choices = paths.map<{ title: string; value: string | null }>(f => ({
    value: f,
    title: f.startsWith(projectDir) ? path.relative(projectDir, f) : f,
  }));

  choices.push({
    title: 'None of the above',
    value: null,
  });

  Log.log(
    'Multiple Google Service Account JSON keys have been found inside your project directory.'
  );
  const { selectedPath } = await promptAsync({
    name: 'selectedPath',
    type: 'select',
    message: 'Choose the key you want to use:',
    choices,
  });

  Log.addNewLineIfNone();
  return selectedPath;
}

async function confirmDetectedPathAsync(path: string): Promise<boolean> {
  Log.log(`A Google Service Account JSON key has been found at\n  ${chalk.underline(path)}`);
  const confirm = await confirmAsync({
    message: 'Would you like to use this file?',
  });
  Log.addNewLineIfNone();
  return confirm;
}
