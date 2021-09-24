import { GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Account } from '../../../user/Account';
import { Context } from '../../context';
import { getCredentialsFromUserAsync } from '../../utils/promptForCredentials';
import { googleServiceAccountKeySchema } from '../credentials';
import { validateServiceAccountKey } from '../utils/googleServiceAccountKey';

export class CreateGoogleServiceAccountKey {
  constructor(private account: Account) {}

  public async runAsync(ctx: Context): Promise<GoogleServiceAccountKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`New Google Service Account Key cannot be created in non-interactive mode.`);
    }
    const providedGsaKey = await getCredentialsFromUserAsync(googleServiceAccountKeySchema, {});
    if (!providedGsaKey) {
      throw new Error('A valid Google Service Account Key must be provided');
    }
    const jsonKeyObject = validateServiceAccountKey(providedGsaKey.keyJson);
    const gsaKeyFragment = await ctx.android.createGoogleServiceAccountKeyAsync(
      this.account,
      jsonKeyObject
    );
    Log.succeed('Uploaded Google Service Account Key');
    return gsaKeyFragment;
  }
}
