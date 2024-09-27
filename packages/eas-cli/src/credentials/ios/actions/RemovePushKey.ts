import { selectPushKeyAsync } from './PushKeyUtils';
import { AccountFragment, ApplePushKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';

export class SelectAndRemovePushKey {
  constructor(private readonly account: AccountFragment) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    const selected = await selectPushKeyAsync(ctx, this.account);
    if (selected) {
      await new RemovePushKey(selected).runAsync(ctx);
      Log.succeed('Removed push key');
      Log.newLine();
    }
  }
}

export class RemovePushKey {
  constructor(private readonly pushKey: ApplePushKeyFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(`Cannot remove push keys in non-interactive mode`);
    }

    const apps = this.pushKey.iosAppCredentialsList.map(appCredentials => appCredentials.app);
    if (apps.length !== 0) {
      // iosAppCredentialsList is capped at 20 on www
      const appFullNames = apps
        .map(app => app.fullName)
        .slice(0, 19)
        .join(',');
      const andMaybeMore = apps.length > 19 ? ' (and more)' : '';
      const confirm = await confirmAsync({
        message: `Removing this push key will disable push notifications for ${appFullNames}${andMaybeMore}. Do you want to continue?`,
      });
      if (!confirm) {
        Log.log('Aborting');
        return;
      }
    }

    Log.log('Removing Push Key');
    await ctx.ios.deletePushKeyAsync(ctx.graphqlClient, this.pushKey.id);

    let shouldRevoke = false;
    if (!ctx.nonInteractive) {
      shouldRevoke = await confirmAsync({
        message: `Do you also want to revoke this Push Key on the Apple Developer Portal?`,
      });
    } else if (ctx.nonInteractive) {
      Log.log('Skipping certificate revocation on the Apple Developer Portal.');
    }
    if (shouldRevoke) {
      await ctx.appStore.revokePushKeyAsync([this.pushKey.keyIdentifier]);
    }
  }
}
