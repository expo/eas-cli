import {
  AppStoreApiKeyPurpose,
  PURPOSE_TO_ROLES,
  provideOrGenerateAscApiKeyAsync,
} from './AscApiKeyUtils';
import { ChooseAssociatedAppleTeamId } from './ChooseAssociatedAppleTeamId';
import { UpdateAppleTeamInfo } from './UpdateAppleTeamInfo';
import {
  AccountFragment,
  AppStoreConnectApiKeyFragment,
  AppleTeamFragment,
} from '../../../graphql/generated';
import { CredentialsContext } from '../../context';
import { MinimalAscApiKey } from '../credentials';

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
    const appleTeam = await this.ensureKeyHasAppleTeamInfoAsync(ctx, ascApiKey);

    return await ctx.ios.createAscApiKeyAsync(ctx.graphqlClient, this.account, {
      ...ascApiKey,
      teamId: appleTeam.appleTeamIdentifier,
    });
  }

  private async ensureKeyHasAppleTeamInfoAsync(
    ctx: CredentialsContext,
    ascApiKey: MinimalAscApiKey
  ): Promise<AppleTeamFragment> {
    let appleTeamIdentifier = ascApiKey.teamId;
    if (!appleTeamIdentifier) {
      const chooseAssociatedAppleTeamIdAction = new ChooseAssociatedAppleTeamId(
        'App Store Connect API Key'
      );
      appleTeamIdentifier = await chooseAssociatedAppleTeamIdAction.runAsync(ctx);
    }
    const updateAppleTeamAction = new UpdateAppleTeamInfo(this.account, appleTeamIdentifier);
    return await updateAppleTeamAction.runAsync(ctx);
  }
}
