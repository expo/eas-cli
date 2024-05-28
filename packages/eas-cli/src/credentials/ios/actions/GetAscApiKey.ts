import { AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export class GetAscApiKey {
  static async getForBuildServiceAsync(
    app: AppLookupParams,
    ctx: CredentialsContext
  ): Promise<AppStoreConnectApiKeyFragment | null> {
    const appCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      app
    );
    const ascApiKey = appCredentials?.appStoreConnectApiKeyForBuilds;
    if (!ascApiKey) {
      return null;
    }
    const appleTeam = ascApiKey.appleTeam;
    const appleTeamIdentifier = appleTeam?.appleTeamIdentifier;
    const appleTeamType = appleTeam?.appleTeamType;
    const hasAppleTeamInfo = !!appleTeamIdentifier && !!appleTeamType;
    if (!hasAppleTeamInfo) {
      Log.warn(
        `App Store Connect API Key for EAS Build is missing Apple Team information. Run "eas credentials" and select "Use an existing API Key" to update the missing information.`
      );
      return null;
    }

    return ascApiKey;
  }
}
