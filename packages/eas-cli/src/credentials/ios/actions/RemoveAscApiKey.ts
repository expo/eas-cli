import { AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { selectAscApiKeysFromAccountAsync } from './AscApiKeyUtils';

export class SelectAndRemoveAscApiKey {
  constructor(private account: Account) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    const selected = await selectAscApiKeysFromAccountAsync(ctx, this.account);
    if (selected) {
      await new RemoveAscApiKey(this.account, selected).runAsync(ctx);
      Log.succeed('Removed App Store Connect Api Key');
      Log.newLine();
    }
  }
}

export class RemoveAscApiKey {
  constructor(private account: Account, private ascApiKey: AppStoreConnectApiKeyFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(`Cannot remove App Store Connect Api Keys in non-interactive mode`);
    }

    // TODO(quin): add an extra edge on AppStoreConnectApiKey to find the apps using it
    const confirm = await confirmAsync({
      message: `Deleting this Api Key may affect your projects that rely on it. Do you want to continue?`,
    });
    if (!confirm) {
      Log.log('Aborting');
      return;
    }

    Log.log('Removing Api Key');
    await ctx.ios.deleteAscApiKeyAsync(this.ascApiKey.id);

    let shouldRevoke = false;
    if (!ctx.nonInteractive) {
      shouldRevoke = await confirmAsync({
        message: `Do you also want to revoke this Api Key on the Apple Developer Portal?`,
      });
    } else if (ctx.nonInteractive) {
      Log.log('Skipping Api Key revocation on the Apple Developer Portal.');
    }
    if (shouldRevoke) {
      await ctx.appStore.revokeAscApiKeyAsync(this.ascApiKey.keyIdentifier);
    }
  }
}
