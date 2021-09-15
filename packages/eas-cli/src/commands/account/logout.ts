import { Command } from '@oclif/command';

import Log from '../../log';
import { logoutAsync } from '../../user/User';

export default class AccountLogout extends Command {
  static description = 'log out';

  static aliases = ['logout'];

  async run(): Promise<void> {
    await logoutAsync();
    Log.log('Logged out');
  }
}
