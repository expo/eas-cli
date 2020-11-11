import { Command } from '@oclif/command';

import { showLoginPromptAsync } from '../../user/actions';

export default class AccountLogin extends Command {
  static description = 'log in with your EAS account';

  static aliases = ['login'];

  async run() {
    this.log('Log in to EAS');
    await showLoginPromptAsync();
    this.log('Logged in.');
  }
}
