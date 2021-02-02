import chalk from 'chalk';

import Log from '../../../log';
import { AndroidCredentials } from '../credentials';
import { keytoolCommandExistsAsync, logKeystoreHashesAsync } from '../utils/keystore';

export async function printAndroidCredentials(credentialsList: AndroidCredentials[]) {
  Log.log(chalk.bold('Available Android credentials'));
  Log.newLine();
  for (const credentials of credentialsList) {
    await printAndroidAppCredentials(credentials);
  }
}

export async function printAndroidAppCredentials(credentials: AndroidCredentials) {
  Log.log(chalk.green(credentials.experienceName));
  Log.log(chalk.bold('  Keystore hashes'));
  if (credentials.keystore?.keystore) {
    if (await keytoolCommandExistsAsync()) {
      try {
        await logKeystoreHashesAsync(credentials.keystore, '    ');
      } catch (error) {
        Log.error('    Failed to parse the Keystore', error);
      }
    } else {
      Log.warn('    keytool is required to calulate Keystore hashes');
    }
  } else {
    Log.log('    -----------------------');
  }
  Log.log(chalk.bold('  Push Notifications credentials'));
  Log.log('    FCM API Key: ', credentials.pushCredentials?.fcmApiKey ?? '---------------------');
  Log.log('\n');
}
