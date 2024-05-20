import {
  AppStoreApiKeyPurpose,
  PURPOSE_TO_ROLES,
  provideOrGenerateAscApiKeyAsync,
} from './AscApiKeyUtils';
import { AccountFragment, AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import { CredentialsContext } from '../../context';

export class CreateAscApiKey {
  constructor(private account: AccountFragment) {}

  public async runAsync(
    ctx: CredentialsContext,
    purpose: AppStoreApiKeyPurpose
  ): Promise<AppStoreConnectApiKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`A new App Store Connect API Key cannot be created in non-interactive mode.`);
    }
    const roles = PURPOSE_TO_ROLES[purpose];
    if (!roles) {
      throw new Error(`Unsupported purpose: ${purpose}`);
    }

    const ascApiKey = await provideOrGenerateAscApiKeyAsync(ctx, roles);
    return await ctx.ios.createAscApiKeyAsync(ctx.graphqlClient, this.account, ascApiKey);
  }
}
