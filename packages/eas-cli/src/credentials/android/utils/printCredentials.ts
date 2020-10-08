import chalk from 'chalk';

import log from '../../../log';
import { AndroidCredentials } from '../credentials';
import { keytoolCommandExistsAsync, logKeystoreHashesAsync } from '../utils/keystore';

export async function printAndroidCredentials(credentialsList: AndroidCredentials[]) {
  log(chalk.bold('Available Android credentials'));
  log();
  for (const credentials of credentialsList) {
    await printAndroidAppCredentials(credentials);
  }
}

export async function printAndroidAppCredentials(credentials: AndroidCredentials) {
  log(chalk.green(credentials.experienceName));
  log(chalk.bold('  Keystore hashes'));
  if (credentials.keystore?.keystore) {
    if (await keytoolCommandExistsAsync()) {
      try {
        await logKeystoreHashesAsync(credentials.keystore, '    ');
      } catch (error) {
        log.error('    Failed to parse the Keystore', error);
      }
    } else {
      log.warn('    keytool is required to calulate Keystore hashes');
    }
  } else {
    log('    -----------------------');
  }
  log(chalk.bold('  Push Notifications credentials'));
  log('    FCM API Key: ', credentials.pushCredentials?.fcmApiKey ?? '---------------------');
  log('\n');
}
