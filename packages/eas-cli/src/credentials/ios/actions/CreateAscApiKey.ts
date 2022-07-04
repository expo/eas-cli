import { AppStoreConnectApiKeyFragment } from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { Account } from '../../../user/Account.js';
import { CredentialsContext } from '../../context.js';
import { AppStoreApiKeyPurpose, provideOrGenerateAscApiKeyAsync } from './AscApiKeyUtils.js';

export class CreateAscApiKey {
  constructor(private account: Account) {}

  public async runAsync(
    ctx: CredentialsContext,
    purpose: AppStoreApiKeyPurpose
  ): Promise<AppStoreConnectApiKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`A new App Store Connect API Key cannot be created in non-interactive mode.`);
    }

    const ascApiKey = await provideOrGenerateAscApiKeyAsync(ctx, purpose);
    const result = await ctx.ios.createAscApiKeyAsync(this.account, ascApiKey);
    Log.succeed('Created App Store Connect API Key');
    return result;
  }
}
