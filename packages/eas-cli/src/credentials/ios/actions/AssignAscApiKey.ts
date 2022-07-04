import {
  AppStoreConnectApiKeyFragment,
  CommonIosAppCredentialsFragment,
} from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { CredentialsContext } from '../../context.js';
import { AppLookupParams } from '../api/GraphqlClient.js';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils.js';
import { AppStoreApiKeyPurpose } from './AscApiKeyUtils.js';

export class AssignAscApiKey {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    ascApiKey: AppStoreConnectApiKeyFragment,
    purpose: AppStoreApiKeyPurpose
  ): Promise<CommonIosAppCredentialsFragment> {
    const appleTeam =
      (await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app)) ?? ascApiKey.appleTeam ?? null;
    const appCredentials = await ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync(
      this.app,
      { appleTeam: appleTeam ?? undefined }
    );
    let updatedAppCredentials;
    if (purpose === AppStoreApiKeyPurpose.SUBMISSION_SERVICE) {
      updatedAppCredentials = await ctx.ios.updateIosAppCredentialsAsync(appCredentials, {
        ascApiKeyIdForSubmissions: ascApiKey.id,
      });
    } else {
      throw new Error(`${purpose} is not yet supported.`);
    }
    Log.succeed(
      `App Store Connect API Key assigned to ${this.app.projectName}: ${this.app.bundleIdentifier} for ${purpose}.`
    );
    return updatedAppCredentials;
  }
}
