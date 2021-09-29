import {
  CommonAndroidAppCredentialsFragment,
  GoogleServiceAccountKeyFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

export class AssignGoogleServiceAccountKey {
  constructor(private app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    googleServiceAccountKey: GoogleServiceAccountKeyFragment
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const appCredentials =
      await ctx.android.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(this.app);
    const updatedAppCredentials = await ctx.android.updateAndroidAppCredentialsAsync(
      appCredentials,
      {
        googleServiceAccountKeyForSubmissionsId: googleServiceAccountKey.id,
      }
    );
    Log.succeed(
      `Google Service Account Key assigned to ${this.app.androidApplicationIdentifier} for submissions`
    );
    return updatedAppCredentials;
  }
}
