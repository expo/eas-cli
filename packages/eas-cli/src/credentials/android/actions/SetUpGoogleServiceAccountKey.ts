import nullthrows from 'nullthrows';

import {
  CommonAndroidAppCredentialsFragment,
  GoogleServiceAccountKeyFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { MissingCredentialsNonInteractiveError } from '../../errors';
import { AppLookupParams } from '../api/GraphqlClient';
import { AssignGoogleServiceAccountKey } from './AssignGoogleServiceAccountKey';
import { CreateGoogleServiceAccountKey } from './CreateGoogleServiceAccountKey';
import { UseExistingGoogleServiceAccountKey } from './UseExistingGoogleServiceAccountKey';

export class SetUpGoogleServiceAccountKey {
  constructor(private app: AppLookupParams) {}

  public async runAsync(ctx: CredentialsContext): Promise<CommonAndroidAppCredentialsFragment> {
    const isKeySetup = await this.isGoogleServiceAccountKeySetupAsync(ctx);
    if (isKeySetup) {
      Log.succeed('Google Service Account Key already set up.');
      return nullthrows(
        await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(
          ctx.graphqlClient,
          this.app
        ),
        'androidAppCredentials cannot be null if google service account key is already set up'
      );
    }
    if (ctx.nonInteractive) {
      throw new MissingCredentialsNonInteractiveError(
        'Google Service Account Keys cannot be set up in --non-interactive mode.'
      );
    }

    const keysForAccount = await ctx.android.getGoogleServiceAccountKeysForAccountAsync(
      ctx.graphqlClient,
      this.app.account
    );
    let googleServiceAccountKey = null;
    if (keysForAccount.length === 0) {
      googleServiceAccountKey = await new CreateGoogleServiceAccountKey(this.app.account).runAsync(
        ctx
      );
    } else {
      googleServiceAccountKey = await this.createOrUseExistingKeyAsync(ctx);
    }
    return await new AssignGoogleServiceAccountKey(this.app).runAsync(ctx, googleServiceAccountKey);
  }

  private async isGoogleServiceAccountKeySetupAsync(ctx: CredentialsContext): Promise<boolean> {
    const appCredentials = await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      this.app
    );
    return !!appCredentials?.googleServiceAccountKeyForSubmissions;
  }

  private async createOrUseExistingKeyAsync(
    ctx: CredentialsContext
  ): Promise<GoogleServiceAccountKeyFragment> {
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
    return (
      (await new UseExistingGoogleServiceAccountKey(this.app.account).runAsync(ctx)) ??
      (await this.createOrUseExistingKeyAsync(ctx))
    );
  }
}
