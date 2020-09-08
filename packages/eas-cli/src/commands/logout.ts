import { Command } from '@oclif/command';

import { logoutAsync } from '../accounts';

export default class Logout extends Command {
  static description = 'log out';

  async run() {
    await logoutAsync();
  }
}
