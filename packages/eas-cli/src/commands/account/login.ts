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
      Log.warn(
        'We detected that you have set EXPO_TOKEN in your environment. If EXPO_TOKEN is set, it takes precedence over the current session as an authentication method.'
      );
      Log.warn(
        'Even if you log in with a different account, EXPO_TOKEN will still be used if set.'
      );
      Log.warn(
        `You don't need to use ${chalk.bold(
          'eas login'
        )} command if you are planning to use EXPO_TOKEN.`
      );

      const shouldContinue = await confirmAsync({
        message: 'Do you want to continue?',
      });
      if (!shouldContinue) {
        Errors.error('Aborted', { exit: 1 });
      }
    }

    if (actor) {
      const loggedInAs = sessionManager.getAccessToken()
        ? `${getActorDisplayName(actor)} (by using EXPO_TOKEN)`
        : getActorDisplayName(actor);
      Log.warn(`You are already logged in as ${chalk.bold(loggedInAs)}.`);

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
