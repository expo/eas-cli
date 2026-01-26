import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { isMultiAccountEnabled } from '../../utils/easCli';

export default class AccountLogout extends EasCommand {
  static override description = 'log out';
  static override aliases = ['logout'];

  static override args = [
    {
      name: 'username',
      description: 'Username of the account to log out (multi-account mode only)',
      required: false,
    },
  ];

  static override flags = {
    all: Flags.boolean({
      description: 'Log out of all accounts (multi-account mode only)',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.SessionManagment,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(AccountLogout);
    const { sessionManager } = await this.getContextAsync(AccountLogout, { nonInteractive: false });

    if (!isMultiAccountEnabled()) {
      // Legacy behavior
      await sessionManager.logoutAsync();
      Log.log('Logged out');
      return;
    }

    // Multi-account mode
    const accounts = sessionManager.getAllAccounts();

    if (accounts.length === 0) {
      Log.log('Not logged in to any accounts.');
      return;
    }

    // Handle --all flag
    if (flags.all) {
      const confirmed = await confirmAsync({
        message: `Log out of all ${accounts.length} account${accounts.length > 1 ? 's' : ''}?`,
      });

      if (!confirmed) {
        Log.log('Aborted');
        return;
      }

      await sessionManager.removeAllAccountsAsync();
      Log.log('Logged out of all accounts');
      return;
    }

    // Handle specific username argument
    if (args.username) {
      const account = accounts.find(a => a.username === args.username);
      if (!account) {
        Log.error(`Account '${args.username}' not found.`);
        Log.log('Logged-in accounts:');
        accounts.forEach(a => {
          Log.log(`  • ${a.username}${a.isActive ? ' (active)' : ''}`);
        });
        process.exit(1);
      }

      await sessionManager.removeAccountAsync(account.userId);
      Log.log(`Logged out of ${chalk.bold(args.username)}`);

      // Show remaining accounts info
      const remainingAccounts = sessionManager.getAllAccounts();
      if (remainingAccounts.length > 0) {
        const activeAccount = remainingAccounts.find(a => a.isActive);
        if (activeAccount) {
          Log.log(`Active account is now: ${chalk.bold(activeAccount.username)}`);
        }
      }
      return;
    }

    // Default: log out of active account
    const activeAccount = accounts.find(a => a.isActive);
    if (!activeAccount) {
      Log.log('No active account to log out of.');
      return;
    }

    await sessionManager.removeAccountAsync(activeAccount.userId);
    Log.log(`Logged out of ${chalk.bold(activeAccount.username)}`);

    // Show remaining accounts info
    const remainingAccounts = sessionManager.getAllAccounts();
    if (remainingAccounts.length > 0) {
      const newActiveAccount = remainingAccounts.find(a => a.isActive);
      if (newActiveAccount) {
        Log.log(`Active account is now: ${chalk.bold(newActiveAccount.username)}`);
      }
    } else {
      Log.log('No accounts remaining. Run `eas login` to log in.');
    }
  }
}
