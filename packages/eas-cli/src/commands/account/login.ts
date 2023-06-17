import { Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';

export default class AccountLogin extends EasCommand {
  static override description = 'log in with your Expo account';
  static override aliases = ['login'];

  static override flags = {
    // can pass either --sso or -s
    sso: Flags.boolean({
      description: 'Login with SSO',
      char: 's',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.SessionManagment,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { sso },
    } = await this.parse(AccountLogin);

    const { sessionManager } = await this.getContextAsync(AccountLogin, { nonInteractive: false });
    await sessionManager.showLoginPromptAsync({ sso });
    Log.log('Logged in');
  }
}
