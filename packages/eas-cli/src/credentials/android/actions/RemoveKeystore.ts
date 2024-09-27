import chalk from 'chalk';

import { BackupKeystore } from './DownloadKeystore';
import { AndroidAppBuildCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

export class RemoveKeystore {
  constructor(private readonly app: AppLookupParams) {}

  async runAsync(
    ctx: CredentialsContext,
    buildCredentials: AndroidAppBuildCredentialsFragment
  ): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(
        "Deleting a keystore is a destructive operation. Start the CLI without the '--non-interactive' flag to delete the credentials."
      );
    }
    const keystore = buildCredentials.androidKeystore;
    if (!keystore) {
      Log.warn(
        `There is no valid Keystore defined for build credentials: ${buildCredentials.name}`
      );
      return;
    }

    this.displayWarning();
    const confirm = await confirmAsync({
      message: 'Permanently delete the Android Keystore?',
      initial: false,
    });
    if (!confirm) {
      return;
    }
    await new BackupKeystore(this.app).runAsync(ctx, buildCredentials);

    await ctx.android.deleteKeystoreAsync(ctx.graphqlClient, keystore);
    Log.succeed('Keystore removed');
  }

  displayWarning(): void {
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
      'Read https://docs.expo.dev/distribution/building-standalone-apps/#if-you-choose-to-build-for-android for more info before proceeding.'
    );
    Log.newLine();
    Log.warn(
      chalk.bold('Your Keystore will be backed up to your current directory if you continue.')
    );
    Log.newLine();
  }
}
