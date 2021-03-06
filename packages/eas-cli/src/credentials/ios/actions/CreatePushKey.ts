import { ApplePushKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Account } from '../../../user/Account';
import { Context } from '../../context';
import { provideOrGeneratePushKeyAsync } from './PushKeyUtils';

export class CreatePushKey {
  constructor(private account: Account) {}

  public async runAsync(ctx: Context): Promise<ApplePushKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`A new push key cannot be created in non-interactive mode.`);
    }

    const pushKey = await provideOrGeneratePushKeyAsync(ctx, this.account.name);
    const result = await ctx.ios.createPushKeyAsync(this.account, pushKey);
    Log.succeed('Created push key');
    return result;
  }
}
