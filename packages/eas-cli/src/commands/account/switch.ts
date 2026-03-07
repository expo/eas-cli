import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { selectAsync } from '../../prompts';
import { isMultiAccountEnabled } from '../../utils/easCli';

export default class AccountSwitch extends EasCommand {
  static override description = 'switch to a different Expo account';

  static override args = [
    {
      name: 'username',
      description: 'Username of the account to switch to',
      required: false,
    },
  ];

  static override contextDefinition = {
    ...this.ContextOptions.SessionManagment,
  };

  // Hide this command when the feature flag is disabled
  static override get hidden(): boolean {
    return !isMultiAccountEnabled();
  }

  async runAsync(): Promise<void> {
    if (!isMultiAccountEnabled()) {
      Log.error(
        'Multi-account switching is not enabled. Set EAS_EXPERIMENTAL_ACCOUNT_SWITCHER=1 to enable.'
      );
      process.exit(1);
    }

    const { args } = await this.parse(AccountSwitch);
    const { sessionManager } = await this.getContextAsync(AccountSwitch, { nonInteractive: false });

    const accounts = sessionManager.getAllAccounts();

    if (accounts.length === 0) {
      Log.warn('No accounts logged in. Run `eas login` to log in.');
      process.exit(1);
    }

    if (accounts.length === 1) {
      Log.log(`Only one account is logged in: ${chalk.bold(accounts[0].username)}`);
      Log.log('Run `eas login` to add another account.');
      return;
    }

    let targetUsername = args.username;

    if (!targetUsername) {
      // Interactive mode: show account picker
      const choices = accounts.map(account => {
        const title = account.isActive
          ? `${account.username} ${chalk.dim('(active)')}`
          : account.username;
        return { title, value: account.username };
      });

      choices.push({
        title: chalk.dim('Add new account...'),
        value: '__add_new__',
      });

      targetUsername = await selectAsync('Select an account:', choices);

      if (targetUsername === '__add_new__') {
        await sessionManager.showLoginPromptAsync();
        Log.log('Logged in');
        return;
      }
    }

    // Check if already active
    const targetAccount = accounts.find(a => a.username === targetUsername);
    if (!targetAccount) {
      Log.error(`Account '${targetUsername}' not found.`);
      Log.log('Available accounts:');
      accounts.forEach(a => {
        Log.log(`  • ${a.username}${a.isActive ? ' (active)' : ''}`);
      });
      process.exit(1);
    }

    if (targetAccount.isActive) {
      Log.log(`Already using account ${chalk.bold(targetUsername)}`);
      return;
    }

    // Switch to the account
    await sessionManager.switchAccountByUsernameAsync(targetUsername);
    Log.log(`Switched to ${chalk.bold(targetUsername)}`);
  }
}
