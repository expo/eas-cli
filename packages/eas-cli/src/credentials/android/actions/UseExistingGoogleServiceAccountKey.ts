import { AccountFragment, GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { selectGoogleServiceAccountKeyAsync } from '../utils/googleServiceAccountKey';

export class UseExistingGoogleServiceAccountKey {
  constructor(private readonly account: AccountFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<GoogleServiceAccountKeyFragment | null> {
    if (ctx.nonInteractive) {
      throw new Error(
        `Existing Google Service Account Key cannot be chosen in non-interactive mode.`
      );
    }
    const gsaKeyFragments = await ctx.android.getGoogleServiceAccountKeysForAccountAsync(
      ctx.graphqlClient,
      this.account
    );
    if (gsaKeyFragments.length === 0) {
      Log.error("There aren't any Google Service Account Keys associated with your account.");
      return null;
    }
    return await selectGoogleServiceAccountKeyAsync(gsaKeyFragments);
  }
}
