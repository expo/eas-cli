import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { getActorDisplayName } from '../../user/User';

export default class AccountView extends EasCommand {
  static override description = 'show the username you are logged in as';
  static override aliases = ['whoami'];

  static override contextDefinition = {
    ...this.ContextOptions.MaybeLoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      maybeLoggedIn: { actor },
    } = await this.getContextAsync(AccountView, { nonInteractive: true });
    if (actor) {
      Log.log(chalk.green(getActorDisplayName(actor)));
    } else {
      Log.warn('Not logged in');
      process.exit(1);
    }
  }
}
