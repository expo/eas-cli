import chalk from 'chalk';
import fs from 'fs-extra';

import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { maybeRenameExistingFileAsync } from '../../../../utils/files';
import { Action, CredentialsManager } from '../../../CredentialsManager';
import { Context } from '../../../context';

interface DownloadKeystoreOptions {
  displayCredentials?: boolean;
  outputPath?: string;
}

export class DownloadKeystore implements Action {
  constructor(private projectFullName: string, private options?: DownloadKeystoreOptions) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const keystore = await ctx.android.fetchKeystoreAsync(this.projectFullName);
    if (!keystore) {
      Log.warn('There is no valid Keystore defined for this app');
      return;
    }

    let displayCredentials = this.options?.displayCredentials;
    if (displayCredentials === undefined && !ctx.nonInteractive) {
      displayCredentials = await confirmAsync({
        message: 'Do you want to display the Android Keystore credentials?',
      });
    }

    const keystorePath =
      this.options?.outputPath ?? `${this.projectFullName.replace('/', '__')}.jks`;

    await maybeRenameExistingFileAsync(ctx.projectDir, keystorePath);

    Log.log(`Saving Keystore to ${keystorePath}`);
    await fs.writeFile(keystorePath, keystore.keystore, 'base64');

    if (displayCredentials) {
      Log.log(`Keystore credentials
  Keystore password: ${chalk.bold(keystore.keystorePassword)}
  Key alias:         ${chalk.bold(keystore.keyAlias)}
  Key password:      ${chalk.bold(keystore.keyPassword)}

  Path to Keystore:  ${keystorePath}
      `);
    }
  }
}

export class BackupKeystore implements Action {
  constructor(private projectFullName: string) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    if (await ctx.android.fetchKeystoreAsync(this.projectFullName)) {
      Log.warn('Backing up your old Android Keystore now...');
      await manager.runActionAsync(
        new DownloadKeystore(this.projectFullName, {
          displayCredentials: true,
          outputPath: `${this.projectFullName}.bak.jks`.replace('/', '__'),
        })
      );
    }
  }
}
