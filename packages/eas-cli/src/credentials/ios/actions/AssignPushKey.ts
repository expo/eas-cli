import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { ApplePushKeyFragment, CommonIosAppCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export class AssignPushKey {
  constructor(private readonly app: AppLookupParams) {}

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
