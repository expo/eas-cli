import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { UpdateKeystore } from './UpdateKeystore';

export class SetupBuildCredentials implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    if (await ctx.android.fetchKeystoreAsync(this.projectFullName)) {
      return;
    }
    if (ctx.nonInteractive) {
      throw new Error('Generating a new Keystore is not supported in --non-interactive mode');
    }

    manager.pushNextAction(new UpdateKeystore(this.projectFullName));
  }
}
