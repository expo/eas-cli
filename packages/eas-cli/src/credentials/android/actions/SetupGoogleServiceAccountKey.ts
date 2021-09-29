import nullthrows from 'nullthrows';
import {  CommonAndroidAppCredentialsFragment, GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import {  promptAsync } from '../../../prompts';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';
import { AssignGoogleServiceAccountKey } from './AssignGoogleServiceAccountKey';
import { CreateGoogleServiceAccountKey } from './CreateGoogleServiceAccountKey';
import { UseExistingGoogleServiceAccountKey } from './UseExistingGoogleServiceAccountKey';


export class SetupGoogleServiceAccountKey {
  constructor(private app: AppLookupParams) {}

  private async isGoogleServiceAccountKeySetupAsync(ctx: Context): Promise<boolean> {
    const appCredentials = await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(this.app);
    return !!(appCredentials?.googleServiceAccountKeyForSubmissions);
  }

  public async runAsync(ctx: Context): Promise<CommonAndroidAppCredentialsFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`Google Service Account Keys cannot be setup in non-interactive mode.`);
    }

    const isKeySetup = await this.isGoogleServiceAccountKeySetupAsync(ctx);
    if (isKeySetup) {
      Log.succeed('Google Service Account Key already setup.')
      return nullthrows(await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(this.app), 'androidAppCredentials cannot be null if google service account key is already setup');
    }

    const keysForAccount = await ctx.android.getGoogleServiceAccountKeysForAccountAsync(this.app.account);
    let googleServiceAccountKey = null;
    if (keysForAccount.length === 0) {
      googleServiceAccountKey = await new CreateGoogleServiceAccountKey(this.app.account).runAsync(ctx);
    } else {
      googleServiceAccountKey = await this.createOrUseExistingKeyAsync(ctx);
    }
    return await new AssignGoogleServiceAccountKey(this.app).runAsync(ctx, googleServiceAccountKey);
  }

  private async createOrUseExistingKeyAsync(ctx: Context): Promise<GoogleServiceAccountKeyFragment> {
    const { action } = await promptAsync({
      type: 'select',
      name: 'action',
      message: 'Select the Google Service Account Key to use for your project:',
      choices: [
        {
          title: '[Choose an existing key]',
          value: 'CHOOSE_EXISTING',
        },
        { title: '[Upload a new service account key]', value: 'GENERATE' },
      ],
    });

    if (action === 'GENERATE') {
      return await new CreateGoogleServiceAccountKey(this.app.account).runAsync(ctx);
    } 
    return await new UseExistingGoogleServiceAccountKey(this.app.account).runAsync(ctx)?? await this.createOrUseExistingKeyAsync(ctx);
  }
}
