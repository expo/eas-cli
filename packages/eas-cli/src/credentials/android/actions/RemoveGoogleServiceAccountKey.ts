import { AccountFragment, GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { selectGoogleServiceAccountKeyAsync } from '../utils/googleServiceAccountKey';

export class SelectAndRemoveGoogleServiceAccountKey {
  constructor(private readonly account: AccountFragment) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(
        `Cannot select and remove Google Service Account Keys in non-interactive mode.`
      );
    }

    const gsaKeyFragments = await ctx.android.getGoogleServiceAccountKeysForAccountAsync(
      ctx.graphqlClient,
      this.account
    );
    if (gsaKeyFragments.length === 0) {
      Log.warn("There aren't any Google Service Account Keys associated with your account.");
      return;
    }

    const selected = await selectGoogleServiceAccountKeyAsync(gsaKeyFragments);
    await new RemoveGoogleServiceAccountKey(selected).runAsync(ctx);
    Log.succeed('Removed Google Service Account Key.');
    Log.newLine();
  }
}

export class RemoveGoogleServiceAccountKey {
  constructor(private readonly googleServiceAccountKey: GoogleServiceAccountKeyFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(`Cannot remove Google Service Account Keys in non-interactive mode`);
    }

    // TODO(quin): add an extra edge on GoogleServiceAccountKey to find the apps using it
    const confirm = await confirmAsync({
      message: `Deleting this Google Service Account Key may affect your projects that rely on it. Do you want to continue?`,
    });
    if (!confirm) {
      Log.log('Aborting');
      return;
    }

    Log.log('Removing Google Service Account Key.');
    await ctx.android.deleteGoogleServiceAccountKeyAsync(
      ctx.graphqlClient,
      this.googleServiceAccountKey
    );
  }
}
