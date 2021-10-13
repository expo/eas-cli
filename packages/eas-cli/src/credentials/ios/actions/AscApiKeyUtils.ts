import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import * as uuid from 'uuid';

import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { getCredentialsFromUserAsync } from '../../utils/promptForCredentials';
import { AscApiKey } from '../appstore/Credentials.types';
import { AscApiKeyPath, MinimalAscApiKey, ascApiKeyMetadataSchema } from '../credentials';

export async function promptForAscApiKeyAsync(): Promise<AscApiKeyPath> {
  Log.log(
    chalk.bold('An App Store Connect Api key is required to upload your app to the Apple App Store')
  );
  Log.log(
    `If you're not sure what this is or how to create one, ${learnMore(
      'https://expo.fyi/creating-asc-api-key'
    )}`
  );

  const { keyP8Path } = await promptAsync({
    type: 'text',
    name: 'keyP8Path',
    message: 'Path to App Store Connect Api Key:',
    initial: 'AuthKey_ABCD.p8',
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
  const regex = /^AuthKey_(?<keyId>\w+)\.p8$/; // Common ASC Api file name downloaded from Apple
  const bestEffortKeyId = path.basename(keyP8Path).match(regex)?.groups?.keyId;
  const ascApiKeyMetadata = await getCredentialsFromUserAsync(ascApiKeyMetadataSchema, {
    keyId: bestEffortKeyId,
  });
  return { ...ascApiKeyMetadata, keyP8Path };
}

export async function promptForIssuerIdAsync(): Promise<string> {
  Log.log(chalk.bold('An App Store Connect Issuer ID is required'));
  Log.log(
    `If you're not sure what this is or how to find yours, ${learnMore(
      'https://expo.fyi/asc-issuer-id'
    )}`
  );

  const { issuerId } = await promptAsync({
    type: 'text',
    name: 'issuerId',
    message: 'App Store Connect Issuer ID:',
    validate: (input: string) => uuid.validate(input),
  });

  return issuerId;
}

export async function getMinimalAscApiKeyAsync(ascApiKey: AscApiKey): Promise<MinimalAscApiKey> {
  return {
    ...ascApiKey,
    issuerId: ascApiKey.issuerId ?? (await promptForIssuerIdAsync()),
  };
}
