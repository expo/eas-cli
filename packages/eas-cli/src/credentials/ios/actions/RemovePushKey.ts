import { ApplePushKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { selectPushKeyAsync } from './PushKeyUtils';

export class SelectAndRemovePushKey {
  constructor(private account: Account) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    const selected = await selectPushKeyAsync(ctx, this.account);
    if (selected) {
      await new RemovePushKey(this.account, selected).runAsync(ctx);
      Log.succeed('Removed push key');
      Log.newLine();
    }
  }
}

export class RemovePushKey {
  constructor(private account: Account, private pushKey: ApplePushKeyFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(`Cannot remove push keys in non-interactive mode`);
    }

    const apps = this.pushKey.iosAppCredentialsList.map(appCredentials => appCredentials.app);
    if (apps.length !== 0) {
      const appFullNames = apps.map(app => app.fullName).join(',');
      const confirm = await confirmAsync({
        message: `Removing this push key will disable push notifications for ${appFullNames}. Do you want to continue?`,
      });
      if (!confirm) {
        Log.log('Aborting');
        return;
      }
    }

    Log.log('Removing Push Key');
    await ctx.ios.deletePushKeyAsync(this.pushKey.id);

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
