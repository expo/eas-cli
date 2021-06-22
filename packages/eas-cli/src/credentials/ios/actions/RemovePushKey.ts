import { ApplePushKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { Context } from '../../context';
import { selectPushKeyAsync } from './PushKeyUtils';

export class SelectAndRemovePushKey {
  constructor(private account: Account) {}

  async runAsync(ctx: Context): Promise<void> {
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

  public async runAsync(ctx: Context): Promise<void> {
    if (ctx.nonInteractive) {
      throw new Error(`Cannot remove push keys in non-interactive mode`);
    }

    // TODO(quin): show the projects that rely on this
    const confirm = await confirmAsync({
      message: `Removing this push key will disable push notifications for projects that rely on it. Do you want to continue?`,
    });

    if (!confirm) {
      return;
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
