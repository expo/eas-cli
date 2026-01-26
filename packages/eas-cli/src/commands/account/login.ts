import { Errors, Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { confirmAsync, selectAsync } from '../../prompts';
import { getActorDisplayName } from '../../user/User';
import { isMultiAccountEnabled } from '../../utils/easCli';

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
      if (isMultiAccountEnabled()) {
        // Multi-account mode: offer options
        await this.handleMultiAccountLoginAsync(sessionManager, actor, sso);
        return;
      }

      // Legacy mode: simple confirmation
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

  private async handleMultiAccountLoginAsync(
    sessionManager: any,
    actor: any,
    sso: boolean
  ): Promise<void> {
    const accounts = sessionManager.getAllAccounts();
    const currentUsername = getActorDisplayName(actor);

    Log.log(`You're logged in as ${chalk.bold(currentUsername)}.`);

    const choices: { title: string; value: string }[] = [
      {
        title: 'Add another account',
        value: 'add',
      },
    ];

    // Add switch options for other accounts
    const otherAccounts = accounts.filter((a: any) => !a.isActive);
    if (otherAccounts.length > 0) {
      for (const account of otherAccounts) {
        choices.push({
          title: `Switch to ${account.username}`,
          value: `switch:${account.username}`,
        });
      }
    }

    choices.push({
      title: 'Cancel',
      value: 'cancel',
    });

    const action = await selectAsync('What would you like to do?', choices);

    if (action === 'cancel') {
      Errors.error('Aborted', { exit: 1 });
    }

    if (action === 'add') {
      await sessionManager.showLoginPromptAsync({ sso });
      const newAccounts = sessionManager.getAllAccounts();
      Log.log('Logged in');
      Log.log(`You now have ${newAccounts.length} account${newAccounts.length > 1 ? 's' : ''}.`);
      return;
    }

    if (action.startsWith('switch:')) {
      const username = action.slice('switch:'.length);
      await sessionManager.switchAccountByUsernameAsync(username);
      Log.log(`Switched to ${chalk.bold(username)}`);
    }
  }
}
