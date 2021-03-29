import { Command } from '@oclif/command';
import chalk from 'chalk';

import Log from '../../log';
import { getActorDisplayName, getUserAsync } from '../../user/User';

export default class AccountView extends Command {
  static description = 'show the username you are logged in as';

  static aliases = ['whoami'];

  async run() {
    const user = await getUserAsync();
    if (user) {
      Log.log(chalk.green(getActorDisplayName(user)));
    } else {
      Log.warn('Not logged in');
      process.exit(1);
    }
  }
}
