import {
  CommonAndroidAppCredentialsFragment,
  GoogleServiceAccountKeyFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';

export class AssignGoogleServiceAccountKeyForSubmissions {
  constructor(private readonly app: AppLookupParams) {}

  public async runAsync(
    ctx: CredentialsContext,
    googleServiceAccountKey: GoogleServiceAccountKeyFragment
  ): Promise<CommonAndroidAppCredentialsFragment> {
    const appCredentials =
      await ctx.android.createOrGetExistingAndroidAppCredentialsWithBuildCredentialsAsync(
        ctx.graphqlClient,
        this.app
      );
    const updatedAppCredentials = await ctx.android.updateAndroidAppCredentialsAsync(
      ctx.graphqlClient,
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
