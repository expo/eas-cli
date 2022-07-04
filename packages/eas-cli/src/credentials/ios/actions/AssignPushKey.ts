import {
  ApplePushKeyFragment,
  CommonIosAppCredentialsFragment,
} from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { CredentialsContext } from '../../context.js';
import { AppLookupParams } from '../api/GraphqlClient.js';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils.js';

export class AssignPushKey {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    pushKey: ApplePushKeyFragment
  ): Promise<CommonIosAppCredentialsFragment> {
    const appleTeam =
      (await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app)) ?? pushKey.appleTeam ?? null;
    const appCredentials = await ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync(
      this.app,
      { appleTeam: appleTeam ?? undefined }
    );
    const updatedAppCredentials = await ctx.ios.updateIosAppCredentialsAsync(appCredentials, {
      applePushKeyId: pushKey.id,
    });
    Log.succeed(`Push Key assigned to ${this.app.projectName}: ${this.app.bundleIdentifier}`);
    return updatedAppCredentials;
  }
}
