import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { getActorDisplayName } from '../../user/User';

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
    ...this.ContextOptions.MaybeLoggedIn,
    ...this.ContextOptions.SessionManagment,
  };

  async runAsync(): Promise<void> {
    const {
      flags: { sso },
    } = await this.parse(AccountLogin);

    const {
      sessionManager,
      maybeLoggedIn: { actor },
    } = await this.getContextAsync(AccountLogin, { nonInteractive: false });

    if (sessionManager.getAccessToken()) {
      throw new Error(
        'EXPO_TOKEN is set in your environment, and is being used for all EAS authentication. To use username/password authentication, unset EXPO_TOKEN in your environment and re-run the command.'
      );
    }

    if (actor) {
      Log.warn(`You are already logged in as ${chalk.bold(getActorDisplayName(actor))}.`);

      const shouldContinue = await confirmAsync({
        message: 'Do you want to continue?',
      });
      if (!shouldContinue) {
        Errors.error('Aborted', { exit: 1 });
      }
    }

    await sessionManager.showLoginPromptAsync({ sso });
    Log.log('Logged in');
  }
}
