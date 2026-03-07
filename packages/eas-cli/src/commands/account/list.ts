import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { fromNow } from '../../utils/date';
import { isMultiAccountEnabled } from '../../utils/easCli';

export default class AccountList extends EasCommand {
  static override description = 'list all logged-in Expo accounts';

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
        'Multi-account listing is not enabled. Set EAS_EXPERIMENTAL_ACCOUNT_SWITCHER=1 to enable.'
      );
      process.exit(1);
    }

    const { sessionManager } = await this.getContextAsync(AccountList, { nonInteractive: true });

    if (sessionManager.getAccessToken()) {
      Log.log(chalk.yellow('Using EXPO_TOKEN from environment for authentication.'));
      Log.log('Account switching is not available when using EXPO_TOKEN.');
      return;
    }

    const accounts = sessionManager.getAllAccounts();

    if (accounts.length === 0) {
      Log.log('No accounts logged in.');
      Log.log(`Run ${chalk.bold('eas login')} to log in.`);
      return;
    }

    Log.log('Logged-in accounts:');
    Log.newLine();

    for (const account of accounts) {
      const marker = account.isActive ? chalk.green('●') : chalk.dim('○');
      const activeLabel = account.isActive ? chalk.dim(' (active)') : '';
      const username = account.isActive ? chalk.bold(account.username) : account.username;

      Log.log(`${marker} ${username}${activeLabel}`);

      if (account.lastUsedAt) {
        const lastUsed = fromNow(new Date(account.lastUsedAt));
        Log.log(chalk.dim(`  └─ Last used: ${lastUsed} ago`));
      }
    }

    Log.newLine();
    Log.log(`Use ${chalk.bold('eas account:switch')} to change accounts.`);
  }
}
