import { AppStoreApiKeyPurpose, provideOrGenerateAscApiKeyAsync } from './AscApiKeyUtils';
import { AccountFragment, AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import { CredentialsContext } from '../../context';

export class CreateAscApiKey {
  constructor(private readonly account: AccountFragment) {}

  public async runAsync(
    ctx: CredentialsContext,
    purpose: AppStoreApiKeyPurpose
  ): Promise<AppStoreConnectApiKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`A new App Store Connect API Key cannot be created in non-interactive mode.`);
    }

    const ascApiKey = await provideOrGenerateAscApiKeyAsync(ctx, purpose);
    return await ctx.ios.createAscApiKeyAsync(ctx.graphqlClient, this.account, ascApiKey);
  }
}
