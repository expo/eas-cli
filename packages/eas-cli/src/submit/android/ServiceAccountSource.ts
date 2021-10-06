import chalk from 'chalk';
import glob from 'fast-glob';
import fs from 'fs-extra';
import path from 'path';

import Log, { learnMore } from '../../log';
import { findProjectRootAsync } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { filterAsync } from '../../utils/filterAsync';
import { isExistingFileAsync } from '../utils/files';

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

interface ServiceAccountDetectSource extends ServiceAccountSourceBase {
  sourceType: ServiceAccountSourceType.detect;
}

export type ServiceAccountSource =
  | ServiceAccountPathSource
  | ServiceAccountPromptSource
  | ServiceAccountDetectSource;

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
  if (!(await isExistingFileAsync(source.path))) {
    Log.warn(`File ${source.path} doesn't exist.`);
    return await getServiceAccountAsync({ sourceType: ServiceAccountSourceType.prompt });
  }
  return source.path;
}

async function handleDetectSourceAsync(_source: ServiceAccountDetectSource): Promise<string> {
  const projectDir = await findProjectRootAsync();
  const foundFilePaths = await glob('**/*.json', {
    cwd: projectDir,
    ignore: ['app.json', 'package*.json', 'tsconfig.json', 'node_modules'],
  });

  const googleServiceFiles = await filterAsync(
    foundFilePaths.map(file => path.join(projectDir, file)),
    fileIsGoogleServicesAsync
  );

  if (googleServiceFiles.length > 1) {
    const selectedPath = await displayPathChooserAsync(googleServiceFiles, projectDir);

    if (selectedPath !== false) {
      return selectedPath;
    }
  } else if (googleServiceFiles.length === 1) {
    const [detectedPath] = googleServiceFiles;

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
    // eslint-disable-next-line async-protect/async-suffix
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

async function displayPathChooserAsync(
  paths: string[],
  projectDir: string
): Promise<string | false> {
  const choices = paths.map<{ title: string; value: string | false }>(f => ({
    value: f,
    title: f.startsWith(projectDir) ? path.relative(projectDir, f) : f,
  }));

  choices.push({
    title: 'None of the above',
    value: false,
  });

  Log.log(
    'Multiple Google Service Account JSON keys have been found inside your project directory.'
  );
  const { selectedPath } = await promptAsync({
    name: 'selectedPath',
    type: 'select',
    message: 'Choose the key you want to use for this submission:',
    choices,
  });

  Log.addNewLineIfNone();
  return selectedPath;
}

async function confirmDetectedPathAsync(path: string): Promise<boolean> {
  Log.log(`A Google Service Account JSON key has been found at\n  ${chalk.underline(path)}`);
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
