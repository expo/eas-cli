import chalk from 'chalk';

import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { BackupKeystore } from './DownloadKeystore';

export class RemoveKeystore implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    if (!(await ctx.android.fetchKeystoreAsync(this.projectFullName))) {
      Log.warn('There is no Keystore defined for this app.');
      return;
    }

    this.displayWarning();

    if (ctx.nonInteractive) {
      throw new Error(
        "Deleting build credentials is a destructive operation. Start the CLI without the '--non-interactive' flag to delete the credentials."
      );
    }

    const confirm = await confirmAsync({
      message: 'Permanently delete the Android build credentials from our servers?',
      initial: false,
    });
    if (confirm) {
      await manager.runActionAsync(new BackupKeystore(this.projectFullName));

      await ctx.android.removeKeystoreAsync(this.projectFullName);
      Log.succeed('Keystore removed');
    }
  }

  displayWarning() {
    Log.newLine();
    Log.warn(
      `Clearing your Android build credentials from our build servers is a ${chalk.bold(
        'PERMANENT and IRREVERSIBLE action.'
      )}`
    );
    Log.warn(
      chalk.bold(
        'Android Keystore must be identical to the one previously used to submit your app to the Google Play Store.'
      )
    );
    Log.warn(
      'Please read https://docs.expo.io/distribution/building-standalone-apps/#if-you-choose-to-build-for-android for more info before proceeding.'
    );
    Log.newLine();
    Log.warn(
      chalk.bold('Your Keystore will be backed up to your current directory if you continue.')
    );
    Log.newLine();
  }
}
