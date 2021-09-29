import { GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { selectGoogleServiceAccountKeyAsync } from '../utils/googleServiceAccountKey';

export class UseExistingGoogleServiceAccountKey {
  constructor(private account: Account) {}

  public async runAsync(ctx: CredentialsContext): Promise<GoogleServiceAccountKeyFragment | null> {
    if (ctx.nonInteractive) {
      throw new Error(
        `Existing Google Service Account Key cannot be chosen in non-interactive mode.`
      );
    }
    const gsaKeyFragments = await ctx.android.getGoogleServiceAccountKeysForAccountAsync(
      this.account
    );
    if (gsaKeyFragments.length === 0) {
      Log.error("There aren't any Google Service Account Keys associated with your account.");
      return null;
    }
    return await selectGoogleServiceAccountKeyAsync(gsaKeyFragments);
  }
}
