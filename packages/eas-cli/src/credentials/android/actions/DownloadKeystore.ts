import chalk from 'chalk';
import fs from 'fs-extra';

import { AndroidAppBuildCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { maybeRenameExistingFileAsync } from '../../../utils/files';
import { CredentialsContext } from '../../context';
import { AppLookupParams, formatProjectFullName } from '../api/GraphqlClient';
import { displayAndroidKeystore } from '../utils/printCredentials';

interface DownloadKeystoreOptions {
  app: AppLookupParams;
  displaySensitiveInformation?: boolean;
  outputPath?: string;
}

export class DownloadKeystore {
  constructor(private readonly options: DownloadKeystoreOptions) {}

  public async runAsync(
    ctx: CredentialsContext,
    buildCredentials: AndroidAppBuildCredentialsFragment
  ): Promise<void> {
    const keystore = buildCredentials.androidKeystore;
    if (!keystore) {
      Log.warn(
        `There is no valid Keystore defined for build credentials: ${buildCredentials.name}`
      );
      return;
    }

    let displaySensitiveInformation = this.options?.displaySensitiveInformation;
    if (displaySensitiveInformation === undefined && !ctx.nonInteractive) {
      displaySensitiveInformation = await confirmAsync({
        message: 'Do you want to display the sensitive information of the Android Keystore?',
      });
    }
    const projectFullName = formatProjectFullName(this.options.app);
    const keystorePath = this.options?.outputPath ?? `${projectFullName.replace('/', '__')}.jks`;

    await maybeRenameExistingFileAsync(ctx.projectDir, keystorePath);

    Log.log(`Saving Keystore to ${keystorePath}`);
    await fs.writeFile(keystorePath, keystore.keystore, 'base64');

    // non-sensitive information
    displayAndroidKeystore(keystore);

    if (displaySensitiveInformation) {
      Log.newLine();
      Log.log(`Sensitive Keystore information:
    Keystore password: ${chalk.bold(keystore.keystorePassword)}
    Key alias:         ${chalk.bold(keystore.keyAlias)}
    Key password:      ${chalk.bold(keystore.keyPassword)}

    Path to Keystore:  ${keystorePath}
      `);
    }
    Log.newLine();
  }
}

export class BackupKeystore {
  constructor(private readonly app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    buildCredentials: AndroidAppBuildCredentialsFragment
  ): Promise<void> {
    if (!buildCredentials.androidKeystore) {
      return;
    }
    const projectFullName = formatProjectFullName(this.app);
    Log.warn('Backing up your old Android Keystore now...');
    await new DownloadKeystore({
      app: this.app,
      outputPath: `${projectFullName}.bak.jks`.replace('/', '__'),
      displaySensitiveInformation: true,
    }).runAsync(ctx, buildCredentials);
  }
}
