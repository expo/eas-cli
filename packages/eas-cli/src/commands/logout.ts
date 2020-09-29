import { Command } from '@oclif/command';

import { logoutAsync } from '../user/User';

export default class Logout extends Command {
  static description = 'log out';

  async run() {
    await logoutAsync();
    this.log('Logged out.');
  }
}
