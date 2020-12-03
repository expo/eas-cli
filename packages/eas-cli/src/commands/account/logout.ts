import { Command } from '@oclif/command';

import log from '../../log';
import { logoutAsync } from '../../user/User';

export default class AccountLogout extends Command {
  static description = 'log out';

  static aliases = ['logout'];

  async run() {
    await logoutAsync();
    log('Logged out');
  }
}
