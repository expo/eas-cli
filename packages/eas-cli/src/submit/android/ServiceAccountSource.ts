import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';
import fs from 'fs-extra';
import nullthrows from 'nullthrows';

import { SetUpGoogleServiceAccountKeyForSubmissions } from '../../credentials/android/actions/SetUpGoogleServiceAccountKeyForSubmissions';
import { readAndValidateServiceAccountKey } from '../../credentials/android/utils/googleServiceAccountKey';
import Log, { learnMore } from '../../log';
import {
  INVALID_APPLICATION_ID_MESSAGE,
  isApplicationIdValid,
} from '../../project/android/applicationId';
import { promptAsync } from '../../prompts';
import { SubmissionContext } from '../context';
import { isExistingFileAsync } from '../utils/files';

export enum ServiceAccountSourceType {
  path,
  prompt,
  credentialsService,
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

export interface ServiceAccountCredentialsServiceSource extends ServiceAccountSourceBase {
  sourceType: ServiceAccountSourceType.credentialsService;
  androidApplicationIdentifier?: string;
}

export type ServiceAccountKeyResult = {
  result: ServiceAccountKeyFile | ServiceAccountKeyFromExpoServers;
  summary: ServiceAccountKeySummary;
};

type ServiceAccountKeySummary = {
  source: 'local' | 'EAS servers';
  path?: string;
  email: string;
};

type ServiceAccountKeyFile = {
  googleServiceAccountKeyJson: string;
};

type ServiceAccountKeyFromExpoServers = {
  googleServiceAccountKeyId: string;
};

export type ServiceAccountSource =
  | ServiceAccountPathSource
  | ServiceAccountPromptSource
  | ServiceAccountCredentialsServiceSource;

export async function getServiceAccountKeyResultAsync(
  ctx: SubmissionContext<Platform.ANDROID>,
  source: ServiceAccountSource
): Promise<ServiceAccountKeyResult> {
  if (source.sourceType === ServiceAccountSourceType.credentialsService) {
    return await getServiceAccountFromCredentialsServiceAsync(ctx, source);
  } else {
    return await getServiceAccountLocallyAsync(source);
  }
}

async function getServiceAccountLocallyAsync(
  source: ServiceAccountSource
): Promise<ServiceAccountKeyResult> {
  const serviceAccountKeyPath = await getServiceAccountKeyPathAsync(source);
  const serviceAccountKey = readAndValidateServiceAccountKey(serviceAccountKeyPath);
  return {
    result: { googleServiceAccountKeyJson: await fs.readFile(serviceAccountKeyPath, 'utf-8') },
    summary: {
      source: 'local',
      path: serviceAccountKeyPath,
      email: serviceAccountKey.client_email,
    },
  };
}

export async function getServiceAccountKeyPathAsync(source: ServiceAccountSource): Promise<string> {
  switch (source.sourceType) {
    case ServiceAccountSourceType.path:
      return await handlePathSourceAsync(source);
    case ServiceAccountSourceType.prompt:
      return await handlePromptSourceAsync(source);
    case ServiceAccountSourceType.credentialsService: {
      throw new Error(`ServiceAccountSource ${source} does not return a path.`);
    }
  }
}

async function promptForApplicationIdAsync(): Promise<string> {
  const { androidPackage } = await promptAsync({
    name: 'androidPackage',
    message: 'Android package name:',
    type: 'text',
    validate: value => (isApplicationIdValid(value) ? true : INVALID_APPLICATION_ID_MESSAGE),
  });
  return androidPackage;
}

export async function getServiceAccountFromCredentialsServiceAsync(
  ctx: SubmissionContext<Platform.ANDROID>,
  source: ServiceAccountCredentialsServiceSource
): Promise<ServiceAccountKeyResult> {
  const appLookupParams = {
    account: nullthrows(
      ctx.user.accounts.find(a => a.name === ctx.accountName),
      `You do not have access to account: ${ctx.accountName}`
    ),
    projectName: ctx.projectName,
    androidApplicationIdentifier:
      source.androidApplicationIdentifier ?? (await promptForApplicationIdAsync()),
  };
  Log.log(
    `Looking up credentials configuration for ${appLookupParams.androidApplicationIdentifier}...`
  );
  const setupGoogleServiceAccountKeyAction = new SetUpGoogleServiceAccountKeyForSubmissions(
    appLookupParams
  );
  const androidAppCredentials = await setupGoogleServiceAccountKeyAction.runAsync(
    ctx.credentialsCtx
  );
  const googleServiceAccountKey = nullthrows(
    androidAppCredentials.googleServiceAccountKeyForSubmissions,
    'Credentials Service must provide a valid GoogleServiceAccountKey'
  );

  return {
    result: {
      googleServiceAccountKeyId: googleServiceAccountKey.id,
    },
    summary: {
      source: 'EAS servers',
      email: googleServiceAccountKey.clientEmail,
    },
  };
}

async function handlePathSourceAsync(source: ServiceAccountPathSource): Promise<string> {
  if (!(await isExistingFileAsync(source.path))) {
    Log.warn(`File ${source.path} doesn't exist.`);
    return await getServiceAccountKeyPathAsync({ sourceType: ServiceAccountSourceType.prompt });
  }
  return source.path;
}

async function handlePromptSourceAsync(_source: ServiceAccountPromptSource): Promise<string> {
  const path = await askForServiceAccountPathAsync();
  return await getServiceAccountKeyPathAsync({
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
        'https://expo.fyi/creating-google-service-account',
        { learnMoreMessage: 'learn more' }
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
