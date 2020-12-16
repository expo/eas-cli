import { Command } from '@oclif/command';
import chalk from 'chalk';

import log from '../../log';
import { getUserAsync } from '../../user/User';
import { getActorDisplayName } from '../../user/actions';

export default class AccountView extends Command {
  static description = 'show the username you are logged in as';

  static aliases = ['whoami'];

  async run() {
    const user = await getUserAsync();
    if (user) {
      log(chalk.green(getActorDisplayName(user)));
    } else {
      log.warn('Not logged in');
      process.exit(1);
    }
  }
}
