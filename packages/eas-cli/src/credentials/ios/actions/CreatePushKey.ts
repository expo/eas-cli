import { provideOrGeneratePushKeyAsync } from './PushKeyUtils';
import { AccountFragment, ApplePushKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';

export class CreatePushKey {
  constructor(private readonly account: AccountFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<ApplePushKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`A new push key cannot be created in non-interactive mode.`);
    }

    const pushKey = await provideOrGeneratePushKeyAsync(ctx);
    const result = await ctx.ios.createPushKeyAsync(ctx.graphqlClient, this.account, pushKey);
    Log.succeed('Created push key');
    return result;
  }
}
