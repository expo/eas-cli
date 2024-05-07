import { AppStoreApiKeyPurpose } from './AscApiKeyUtils';
import { ChooseAssociatedAppleTeamId } from './ChooseAssociatedAppleTeamId';
import { UpdateAppleTeamInfo } from './UpdateAppleTeamInfo';
import {
  AppStoreConnectApiKeyFragment,
  AppleTeamFragment,
  CommonIosAppCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export class AssignAscApiKey {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    ascApiKey: AppStoreConnectApiKeyFragment,
    purpose: AppStoreApiKeyPurpose
  ): Promise<CommonIosAppCredentialsFragment> {
    const [ascApiKeyWithAppleTeam, appleTeam] = await this.ensureKeyHasAppleTeamInfoAsync(
      ctx,
      ascApiKey
    );

    const appCredentials = await ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      this.app,
      { appleTeam }
    );
    let updatedAppCredentials;
    if (purpose === AppStoreApiKeyPurpose.SUBMISSION_SERVICE) {
      updatedAppCredentials = await ctx.ios.updateIosAppCredentialsAsync(
        ctx.graphqlClient,
        appCredentials,
        {
          ascApiKeyIdForSubmissions: ascApiKeyWithAppleTeam.id,
        }
      );
    } else if (purpose === AppStoreApiKeyPurpose.BUILD_SERVICE) {
      updatedAppCredentials = await ctx.ios.updateIosAppCredentialsAsync(
        ctx.graphqlClient,
        appCredentials,
        {
          ascApiKeyIdForBuilds: ascApiKeyWithAppleTeam.id,
        }
      );
    } else {
      throw new Error(`${purpose} is not yet supported.`);
    }
    Log.succeed(
      `App Store Connect API Key assigned to ${this.app.projectName}: ${this.app.bundleIdentifier} for ${purpose}.`
    );
    return updatedAppCredentials;
  }

  private async ensureKeyHasAppleTeamInfoAsync(
    ctx: CredentialsContext,
    ascApiKey: AppStoreConnectApiKeyFragment
  ): Promise<[AppStoreConnectApiKeyFragment, AppleTeamFragment]> {
    let appleTeamIdentifier = ascApiKey.appleTeam?.appleTeamIdentifier;
    if (!appleTeamIdentifier) {
      const chooseAssociatedAppleTeamIdAction = new ChooseAssociatedAppleTeamId(
        'App Store Connect API Key'
      );
      appleTeamIdentifier = await chooseAssociatedAppleTeamIdAction.runAsync(ctx);
    }
    const updateAppleTeamAction = new UpdateAppleTeamInfo(this.app.account, appleTeamIdentifier);
    const appleTeam = await updateAppleTeamAction.runAsync(ctx);
    if (!ascApiKey.appleTeam) {
      const updatedAscApiKey = await ctx.ios.updateAscApiKeyAsync(
        ctx.graphqlClient,
        ascApiKey,
        appleTeam
      );
      return [updatedAscApiKey, appleTeam];
    }
    return [ascApiKey, appleTeam];
  }
}
