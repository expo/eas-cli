import { ApplePushKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { PushKey } from '../appstore/Credentials.types';
import { provideOrGeneratePushKeyAsync } from './PushKeyUtils';

export class CreatePushKey {
  constructor(private account: Account) {}

  public async runAsync(
    ctx: CredentialsContext,
    maybePushKey?: PushKey
  ): Promise<ApplePushKeyFragment> {
    const pushKey = await this.getPushKeyAsync(ctx, maybePushKey);
    const result = await ctx.ios.createPushKeyAsync(this.account, pushKey);
    Log.succeed('Created push key');
    return result;
  }

  private async getPushKeyAsync(ctx: CredentialsContext, pushKey?: PushKey): Promise<PushKey> {
    if (pushKey) {
      return pushKey;
    }
    if (ctx.nonInteractive) {
      throw new Error(`A new push key cannot be created in non-interactive mode.`);
    }
    return await provideOrGeneratePushKeyAsync(ctx);
  }
}
