import { AppStoreApiKeyPurpose } from './AscApiKeyUtils';
import { AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export class GetAscApiKey {
  constructor(
    private app: AppLookupParams,
    private purpose: AppStoreApiKeyPurpose
  ) {}

  public async runAsync(ctx: CredentialsContext): Promise<AppStoreConnectApiKeyFragment | null> {
    const appCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      this.app
    );
    if (this.purpose === AppStoreApiKeyPurpose.SUBMISSION_SERVICE) {
      return appCredentials?.appStoreConnectApiKeyForSubmissions ?? null;
    } else if (this.purpose === AppStoreApiKeyPurpose.BUILD_SERVICE) {
      const ascApiKey = appCredentials?.appStoreConnectApiKeyForBuilds;
      if (!ascApiKey) {
        return null;
      }
      const appleTeam = ascApiKey.appleTeam;
      const hasAppleTeamInfo =
        !!appleTeam && !!appleTeam.appleTeamIdentifier && !!appleTeam.appleTeamType;
      if (!hasAppleTeamInfo) {
        Log.warn(
          `App Store Connect API Key for ${this.purpose} is missing Apple Team information. Run "eas credentials" and select "Use an existing API Key" to update the missing information.`
        );
        return null;
      }
      return ascApiKey;
    } else {
      throw new Error(`App Store Connect API Keys are not yet supported for ${this.purpose}.`);
    }
  }
}
