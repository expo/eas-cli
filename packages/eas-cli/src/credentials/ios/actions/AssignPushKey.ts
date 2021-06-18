import { ApplePushKeyFragment, CommonIosAppCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';
import { AppleTeamMissingError } from '../errors';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';

export class AssignPushKey {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: Context,
    pushKey: ApplePushKeyFragment
  ): Promise<CommonIosAppCredentialsFragment> {
    const appleTeam =
      (await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app)) ?? pushKey.appleTeam ?? null;
    if (!appleTeam) {
      // TODO(quin): make this optional
      throw new AppleTeamMissingError(
        'An Apple Team is required to proceed. You must be authenticated to your Apple account'
      );
    }
    const appCredentials = await ctx.ios.createOrGetIosAppCredentialsWithCommonFieldsAsync(
      this.app,
      { appleTeam }
    );
    const updatedAppCredentials = await ctx.ios.updateIosAppCredentialsAsync(appCredentials, {
      applePushKeyId: pushKey.id,
    });
    Log.succeed(`Push Key assigned to ${this.app.projectName}: ${this.app.bundleIdentifier}`);
    return updatedAppCredentials;
  }
}
