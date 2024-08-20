import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { AppStoreApiKeyPurpose } from './AscApiKeyUtils';
import {
  AppStoreConnectApiKeyFragment,
  CommonIosAppCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export class AssignAscApiKey {
  constructor(private readonly app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    ascApiKey: AppStoreConnectApiKeyFragment,
    purpose: AppStoreApiKeyPurpose
  ): Promise<CommonIosAppCredentialsFragment> {
    const appleTeam =
      (await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app)) ?? ascApiKey.appleTeam ?? null;
    const appCredentials = await ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      this.app,
      { appleTeam: appleTeam ?? undefined }
    );
    let updatedAppCredentials;
    if (purpose === AppStoreApiKeyPurpose.SUBMISSION_SERVICE) {
      updatedAppCredentials = await ctx.ios.updateIosAppCredentialsAsync(
        ctx.graphqlClient,
        appCredentials,
        {
          ascApiKeyIdForSubmissions: ascApiKey.id,
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
}
