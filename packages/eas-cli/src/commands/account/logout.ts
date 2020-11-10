import { Command } from '@oclif/command';

import { logoutAsync } from '../../user/User';

export default class AccountLogout extends Command {
  static description = 'log out';

  static aliases = ['logout'];

  async run() {
    await logoutAsync();
    this.log('Logged out.');
  }
}
