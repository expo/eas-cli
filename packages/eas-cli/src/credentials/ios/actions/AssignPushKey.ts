import { ApplePushKeyFragment, CommonIosAppCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';

export class AssignPushKey {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    pushKey: ApplePushKeyFragment
  ): Promise<CommonIosAppCredentialsFragment> {
    const appleTeam =
      (await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app)) ?? pushKey.appleTeam ?? null;
    const appCredentials = await ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      this.app,
      { appleTeam: appleTeam ?? undefined }
    );
    const updatedAppCredentials = await ctx.ios.updateIosAppCredentialsAsync(
      ctx.graphqlClient,
      appCredentials,
      {
        applePushKeyId: pushKey.id,
      }
    );
    Log.succeed(`Push Key assigned to ${this.app.projectName}: ${this.app.bundleIdentifier}`);
    return updatedAppCredentials;
  }
}
