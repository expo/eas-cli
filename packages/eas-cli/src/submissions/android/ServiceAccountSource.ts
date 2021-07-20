import chalk from 'chalk';
import glob from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';

import Log, { learnMore } from '../../log';
import { findProjectRootAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { isExistingFile } from '../utils/files';

export enum ServiceAccountSourceType {
  path,
  prompt,
  detect,
  // credentialsService,
  // ...
}

interface ServiceAccountSourceBase {
  sourceType: ServiceAccountSourceType;
}

interface ServiceAccountPathSource extends ServiceAccountSourceBase {
  sourceType: ServiceAccountSourceType.path;
  path: string;
}

interface ServiceAccountPromptSource extends ServiceAccountSourceBase {
  sourceType: ServiceAccountSourceType.prompt;
}

interface ServiceAccountDetectSoruce extends ServiceAccountSourceBase {
  sourceType: ServiceAccountSourceType.detect;
}

export type ServiceAccountSource =
  | ServiceAccountPathSource
  | ServiceAccountPromptSource
  | ServiceAccountDetectSoruce;

export async function getServiceAccountAsync(source: ServiceAccountSource): Promise<string> {
  switch (source.sourceType) {
    case ServiceAccountSourceType.path:
      return await handlePathSourceAsync(source);
    case ServiceAccountSourceType.prompt:
      return await handlePromptSourceAsync(source);
    case ServiceAccountSourceType.detect:
      return await handleDetectSourceAsync(source);
  }
}

async function handlePathSourceAsync(source: ServiceAccountPathSource): Promise<string> {
  if (!(await isExistingFile(source.path))) {
    Log.warn(`File ${source.path} doesn't exist.`);
    return await getServiceAccountAsync({ sourceType: ServiceAccountSourceType.prompt });
  }
  return source.path;
}

async function handleDetectSourceAsync(_source: ServiceAccountDetectSoruce): Promise<string> {
  const projectDir = (await findProjectRootAsync()) ?? process.cwd();
  const foundFilenames = await glob('**/*.json', {
    cwd: projectDir,
    ignore: ['app.json', 'package*.json', 'tsconfig.json'],
  });

  const googleServiceFiles = await filterAsync(
    foundFilenames.map(file => path.join(projectDir, file)),
    fileIsGoogleServicesAsync
  );

  if (googleServiceFiles.length > 0) {
    const detectedPath = googleServiceFiles[0];

    if (await confirmDetectedPathAsync(detectedPath)) {
      return detectedPath;
    }
  }

  return await getServiceAccountAsync({ sourceType: ServiceAccountSourceType.prompt });
}

async function handlePromptSourceAsync(_source: ServiceAccountPromptSource): Promise<string> {
  const path = await askForServiceAccountPathAsync();
  return await getServiceAccountAsync({
    sourceType: ServiceAccountSourceType.path,
    path,
  });
}

async function askForServiceAccountPathAsync(): Promise<string> {
  Log.log(
    `${chalk.bold(
      'A Google Service Account JSON key is required to upload your app to Google Play Store'
    )}.\n` +
      `If you're not sure what this is or how to create one, ${learnMore(
        'https://expo.fyi/creating-google-service-account'
      )}`
  );
  const { filePath } = await promptAsync({
    name: 'filePath',
    message: 'Path to Google Service Account file:',
    initial: 'api-0000000000000000000-111111-aaaaaabbbbbb.json',
    type: 'text',
    validate: async (filePath: string) => {
      try {
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          return true;
        }
        return 'Input is not a file.';
      } catch {
        return 'File does not exist.';
      }
    },
  });
  return filePath;
}

async function confirmDetectedPathAsync(path: string): Promise<boolean> {
  Log.log(
    `A valid Google Service Account JSON key has been found in \n   ${chalk.underline(path)}`
  );
  const { confirmed } = await promptAsync({
    name: 'confirmed',
    type: 'confirm',
    message: 'Would you like to use this file?',
    initial: true,
  });

  Log.addNewLineIfNone();
  return confirmed;
}

async function fileIsGoogleServicesAsync(path: string): Promise<boolean> {
  try {
    const jsonFile = await fs.readJson(path);
    return jsonFile.type === 'service_account';
  } catch (e) {
    return false;
  }
}

/**
 * asynchronous array filter
 * @param arr array to filter
 * @param predicate a predicate function to run asynchronously
 * @returns a promise resolving to a filtered array
 */
const filterAsync = async <T>(
  arr: T[],
  predicate: (arg: T, index?: number, array?: T[]) => Promise<boolean>
) => Promise.all(arr.map(predicate)).then(results => arr.filter((_v, index) => results[index]));
