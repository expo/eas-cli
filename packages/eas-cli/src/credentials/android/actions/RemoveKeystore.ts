import chalk from 'chalk';

import log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { BackupKeystore } from './DownloadKeystore';

export class RemoveKeystore implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    if (!(await ctx.android.fetchKeystoreAsync(this.projectFullName))) {
      log.warn('There is no valid Keystore defined for this app');
      return;
    }

    this.displayWarning();

    if (ctx.nonInteractive) {
      throw new Error(
        "Deleting build credentials is a destructive operation. Start the CLI without the '--non-interactive' flag to delete the credentials."
      );
    }

    const answers = await confirmAsync({
      message: 'Permanently delete the Android build credentials from our servers?',
      initial: false,
    });
    if (answers) {
      await manager.runActionAsync(new BackupKeystore(this.projectFullName));

      await ctx.android.removeKeystoreAsync(this.projectFullName);
      log(chalk.green('Keystore removed successfully'));
    }
  }

  displayWarning() {
    log.newLine();
    log.warn(
      `⚠️  Clearing your Android build credentials from our build servers is a ${chalk.red(
        'PERMANENT and IRREVERSIBLE action.'
      )}`
    );
    log.warn(
      chalk.bold(
        'Android Keystore must be identical to the one previously used to submit your app to the Google Play Store.'
      )
    );
    log.warn(
      'Please read https://docs.expo.io/distribution/building-standalone-apps/#if-you-choose-to-build-for-android for more info before proceeding.'
    );
    log.newLine();
    log.warn(
      chalk.bold('Your Keystore will be backed up to your current directory if you continue.')
    );
    log.newLine();
  }
}
