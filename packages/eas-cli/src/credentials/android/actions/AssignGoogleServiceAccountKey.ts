import {
  CommonAndroidAppCredentialsFragment,
  GoogleServiceAccountKeyFragment,
} from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { CredentialsContext } from '../../context.js';
import { AppLookupParams } from '../api/GraphqlClient.js';

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
