import { Command } from '@oclif/command';
import chalk from 'chalk';

import log from '../log';
import { getUserAsync } from '../user/User';

export default class Whoami extends Command {
  static description = 'show the username you are logged in as';

  async run() {
    const user = await getUserAsync();
    if (user?.username) {
      log(chalk.green(user.username));
    } else {
      log.warn('Not logged in.');
      process.exit(1);
    }
  }
}
