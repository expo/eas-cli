import fs from 'fs-extra';
import path from 'path';

import { promptAsync } from '../../../prompts';
import { getCredentialsFromUserAsync } from '../../utils/promptForCredentials';
import { AscApiKeyPath, ascApiKeyMetadataSchema } from '../credentials';

export async function promptForAscApiKeyAsync(): Promise<AscApiKeyPath> {
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
