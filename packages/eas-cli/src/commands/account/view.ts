import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import Log from '../../log';
import { getActorDisplayName, getUserAsync } from '../../user/User';

export default class AccountView extends EasCommand {
  static description = 'show the username you are logged in as';
  static aliases = ['whoami'];

  protected requiresAuthentication = false;

  async runAsync(): Promise<void> {
    const user = await getUserAsync();
    if (user) {
      Log.log(chalk.green(getActorDisplayName(user)));
    } else {
      Log.warn('Not logged in');
      process.exit(1);
    }
  }
}
