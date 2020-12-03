import { Command } from '@oclif/command';

import log from '../../log';
import { showLoginPromptAsync } from '../../user/actions';

export default class AccountLogin extends Command {
  static description = 'log in with your EAS account';

  static aliases = ['login'];

  async run() {
    log('Log in to EAS');
    await showLoginPromptAsync();
    log('Logged in');
  }
}
