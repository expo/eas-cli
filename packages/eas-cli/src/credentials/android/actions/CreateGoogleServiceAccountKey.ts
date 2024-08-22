import chalk from 'chalk';
import fs from 'fs-extra';

import { AccountFragment, GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { GoogleServiceAccountKey } from '../credentials';
import {
  detectGoogleServiceAccountKeyPathAsync,
  readAndValidateServiceAccountKey,
} from '../utils/googleServiceAccountKey';

export class CreateGoogleServiceAccountKey {
  constructor(private readonly account: AccountFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<GoogleServiceAccountKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`New Google Service Account Key cannot be created in non-interactive mode.`);
    }
    const jsonKeyObject = await this.provideAsync(ctx);
    const gsaKeyFragment = await ctx.android.createGoogleServiceAccountKeyAsync(
      ctx.graphqlClient,
      this.account,
      jsonKeyObject
    );
    Log.succeed('Uploaded Google Service Account Key.');
    return gsaKeyFragment;
  }

  private async provideAsync(ctx: CredentialsContext): Promise<GoogleServiceAccountKey> {
    try {
      const keyJsonPath = await this.provideKeyJsonPathAsync(ctx);
      return readAndValidateServiceAccountKey(keyJsonPath);
    } catch (e) {
      Log.error(e);
      return await this.provideAsync(ctx);
    }
  }

  private async provideKeyJsonPathAsync(ctx: CredentialsContext): Promise<string> {
    const detectedPath = await detectGoogleServiceAccountKeyPathAsync(ctx.projectDir);
    if (detectedPath) {
      return detectedPath;
    }

    Log.log(
      `${chalk.bold(
        'A Google Service Account JSON key is required for uploading your app to Google Play Store, and for sending Android Notifications via FCM V1.'
      )}.\n` +
        `If you're not sure what this is or how to create one, ${learnMore(
          'https://expo.fyi/creating-google-service-account',
          { learnMoreMessage: 'learn more' }
        )}`
    );
    const { filePath } = await promptAsync({
      name: 'filePath',
      message: 'Path to Google Service Account file:',
      initial: 'api-0000000000000000000-111111-aaaaaabbbbbb.json',
      type: 'text',
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
    return filePath;
  }
}
