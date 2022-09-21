import chalk from 'chalk';

import EasCommand, { CommandConfiguration } from '../../commandUtils/EasCommand';
import Log from '../../log';
import { getActorDisplayName, getUserAsync } from '../../user/User';

export default class AccountView extends EasCommand {
  static override description = 'show the username you are logged in as';
  static override aliases = ['whoami'];

  protected override commandConfiguration: CommandConfiguration = {
    allowUnauthenticated: true,
    canRunOutsideProject: true,
  };

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
