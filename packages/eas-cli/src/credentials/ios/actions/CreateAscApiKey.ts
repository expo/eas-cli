import { AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { AppStoreApiKeyPurpose, provideOrGenerateAscApiKeyAsync } from './AscApiKeyUtils';

export class CreateAscApiKey {
  constructor(private account: Account) {}

  public async runAsync(
    ctx: CredentialsContext,
    purpose: AppStoreApiKeyPurpose
  ): Promise<AppStoreConnectApiKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`A new App Store Connect Api Key cannot be created in non-interactive mode.`);
    }

    const ascApiKey = await provideOrGenerateAscApiKeyAsync(ctx, purpose);
    const result = await ctx.ios.createAscApiKeyAsync(this.account, ascApiKey);
    Log.succeed('Created App Store Connect Api Key');
    return result;
  }
}
