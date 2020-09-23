import { AndroidCredentials as Android } from '@expo/xdl';
import chalk from 'chalk';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { v4 as uuid } from 'uuid';

import log from '../../log';
import { AppLookupParams } from '../api/IosApi';
import {
  AndroidCredentials,
} from '../credentials';

export async function displayAndroidCredentials(credentialsList: AndroidCredentials[]) {
  log(chalk.bold('Available Android credentials'));
  log();
  for (const credentials of credentialsList) {
    await displayAndroidAppCredentials(credentials);
  }
}

export async function displayAndroidAppCredentials(credentials: AndroidCredentials) {
  const tmpFilename = path.join(os.tmpdir(), `expo_tmp_keystore_${uuid()}file.jks`);
  try {
    log(chalk.green(credentials.experienceName));
    log(chalk.bold('  Upload Keystore hashes'));
    if (credentials.keystore?.keystore) {
      const storeBuf = Buffer.from(credentials.keystore.keystore, 'base64');
      await fs.writeFile(tmpFilename, storeBuf);
      await Android.logKeystoreHashes(
        {
          keystorePath: tmpFilename,
          ...(credentials.keystore as Android.Keystore),
        },
        '    '
      );
    } else {
      log('    -----------------------');
    }
    log(chalk.bold('  Push Notifications credentials'));
    log('    FCM Api Key: ', credentials.pushCredentials?.fcmApiKey ?? '---------------------');
    log('\n');
  } catch (error) {
    log.error('  Failed to parse the Keystore', error);
    log('\n');
  } finally {
    await fs.remove(tmpFilename);
  }
}
