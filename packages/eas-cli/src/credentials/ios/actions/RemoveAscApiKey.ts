import { selectAscApiKeysFromAccountAsync } from './AscApiKeyUtils';
import { AccountFragment, AppStoreConnectApiKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';

export class SelectAndRemoveAscApiKey {
  constructor(private readonly account: AccountFragment) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    const selected = await selectAscApiKeysFromAccountAsync(ctx, this.account);
    if (selected) {
      await new RemoveAscApiKey(selected).runAsync(ctx);
      Log.succeed('Removed App Store Connect API Key');
      Log.newLine();
    }
  }
}

export class RemoveAscApiKey {
  constructor(private readonly ascApiKey: AppStoreConnectApiKeyFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(`Cannot remove App Store Connect API Keys in non-interactive mode.`);
    }

    // TODO(quin): add an extra edge on AppStoreConnectApiKey to find the apps using it
    const confirm = await confirmAsync({
      message: `Deleting this API Key may affect your projects that rely on it. Do you want to continue?`,
    });
    if (!confirm) {
      Log.log('Aborting');
      return;
    }

    Log.log('Removing API Key');
    await ctx.ios.deleteAscApiKeyAsync(ctx.graphqlClient, this.ascApiKey.id);

    let shouldRevoke = false;
    if (!ctx.nonInteractive) {
      shouldRevoke = await confirmAsync({
        message: `Do you also want to revoke this API Key on the Apple Developer Portal?`,
      });
    } else if (ctx.nonInteractive) {
      Log.log('Skipping API Key revocation on the Apple Developer Portal.');
    }
    if (shouldRevoke) {
      await ctx.appStore.revokeAscApiKeyAsync(this.ascApiKey.keyIdentifier);
    }
  }
}
